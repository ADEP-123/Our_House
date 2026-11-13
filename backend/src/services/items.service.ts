import { randomUUID } from 'node:crypto';
import { db } from '../config/database.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/http-error.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { itemsRepository, type ItemFields } from '../repositories/items.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { listRef, logActivity } from './activity.service.js';
import { getAccess, listsService, requireEdit, toItemView, type ListAccess } from './lists.service.js';
import { listPaymentsService } from './list-payments.service.js';
import { calendarService } from './calendar.service.js';
import { notificationsService } from './notifications.service.js';
import { nextTurn, reopenDueItems } from './repeat.service.js';
import { finished, nextDate, todayIn, type RepeatRule } from '../lib/recurrence.js';
import type { ItemRow } from '../repositories/lists.repository.js';

/** El responsable de una tarea tiene que ser del grupo. */
async function checkAssignee(access: ListAccess, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  if (!(await familiesRepository.getRole(access.list.family_id, assigneeId))) throw badRequest('ASSIGNEE_NOT_MEMBER');
}

async function getItem(access: ListAccess, itemId: string) {
  const item = await itemsRepository.find(itemId);
  if (!item || item.list_id !== access.list.id) throw notFound('ITEM_NOT_FOUND');
  return item;
}

function log(access: ListAccess, userId: string, action: string, item: { id: string; text: string }, details?: Record<string, unknown>) {
  return logActivity(access.list.family_id, userId, action, {
    ...listRef(access.list),
    itemId: item.id,
    itemText: item.text,
    details: details ?? null,
  });
}

/**
 * La hora límite se interpreta en la zona horaria de quien la pone (su perfil).
 * Quitar la fecha quita también la hora.
 */
async function withDueZone(userId: string, data: ItemFields, current?: { due_date: string | null }): Promise<ItemFields> {
  if (data.dueDate === null) return { ...data, dueTime: null, dueTz: null };
  if (data.dueDate === undefined && data.dueTime === undefined) return data;
  if (data.dueTime && !(data.dueDate ?? current?.due_date)) throw badRequest('DUE_TIME_NEEDS_DATE');
  const user = await usersRepository.findById(userId);
  return { ...data, dueTz: user?.timezone ?? 'UTC' };
}

/**
 * Repetición y turnos al guardar: la regla toma como inicio la fecha límite (o hoy), y los turnos
 * dejan como responsable a quien le toca.
 */
async function withRepeat(access: ListAccess, userId: string, data: ItemFields, current?: ItemRow): Promise<ItemFields> {
  const next: ItemFields = { ...data };
  if ((data.repeat || data.rotation?.length) && !access.list.features.includes('repeat')) throw badRequest('REPEAT_DISABLED');
  if (data.repeat) {
    const user = await usersRepository.findById(userId);
    const start = data.dueDate ?? current?.due_date ?? todayIn(user?.timezone ?? 'UTC');
    next.repeat = { ...data.repeat, start };
  } else if (data.repeat === undefined && data.dueDate && current?.repeat && data.dueDate !== current.due_date) {
    // Se movió la fecha a mano: las siguientes se cuentan desde la nueva
    next.repeat = { ...current.repeat, start: data.dueDate };
  }
  if (data.rotation !== undefined) {
    const rotation = data.rotation?.length ? [...new Set(data.rotation)] : null;
    for (const id of rotation ?? []) await checkAssignee(access, id);
    next.rotation = rotation;
    if (rotation) {
      const assignee = data.assigneeId ?? current?.assignee_id ?? null;
      next.assigneeId = assignee && rotation.includes(assignee) ? assignee : rotation[0]!;
      next.rotationIndex = rotation.indexOf(next.assigneeId);
    }
  }
  return next;
}

/** Fecha desde la que se cuenta la siguiente: la fecha límite o, si se hizo tarde o "desde que se hizo", hoy */
function countFrom(rule: RepeatRule, dueDate: string, today: string): string {
  return rule.from === 'completion' || dueDate < today ? today : dueDate;
}

/**
 * Se completó una tarea que se repite:
 * - con fecha: pasa a la siguiente (pendiente, subtareas desmarcadas, turno siguiente);
 * - sin fecha: queda hecha hasta el día en que vuelve a aparecer.
 * Devuelve la próxima fecha, o null si no se repite o ya terminó.
 */
async function afterDone(access: ListAccess, userId: string, item: ItemRow): Promise<string | null> {
  const rule = item.repeat;
  if (!rule || !access.list.features.includes('repeat')) return null;
  const user = await usersRepository.findById(userId);
  const today = todayIn(item.due_tz ?? user?.timezone ?? 'UTC');
  const timesDone = item.repeat_done + 1;

  if (!item.due_date) {
    const reopen = nextDate(rule, today);
    const done = finished(rule, reopen, timesDone);
    await itemsRepository.scheduleReopen(item.id, done ? null : reopen);
    return done ? null : reopen;
  }

  const next = nextDate(rule, countFrom(rule, item.due_date, today));
  if (finished(rule, next, timesDone)) return null;

  const turn = await nextTurn(access.list.family_id, item.rotation, item.rotation_index);
  // El evento de esta vez queda como "✓ tarea"; la sincronización crea el de la siguiente
  await calendarService.archiveOccurrence(item.id);
  await itemsRepository.advance(item.id, access.list.id, { dueDate: next, countDone: true, ...turn });
  if (turn && turn.assigneeId !== item.assignee_id) {
    notificationsService.assigned((await itemsRepository.find(item.id))!, access.list, userId, turn.assigneeId);
  }
  return next;
}

async function childIds(itemId: string): Promise<string[]> {
  return (await db().query<{ id: string }>('SELECT id FROM list_items WHERE parent_id = $1', [itemId])).rows.map((r) => r.id);
}

/** Después de cambiar una subtarea, la tarea se completa o vuelve a pendiente según corresponda. */
async function syncParent(access: ListAccess, userId: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const change = await itemsRepository.syncParent(parentId, userId);
  if (!change) return;
  const parent = (await itemsRepository.find(parentId))!;
  const next = change === 'completed' ? await afterDone(access, userId, parent) : null;
  await log(access, userId, change === 'completed' ? 'item.completed' : 'item.uncompleted', parent, { bySubtasks: true, ...(next ? { next } : {}) });
}

export const itemsService = {
  async create(listId: string, userId: string, data: ItemFields & { id?: string; text: string }) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    if (access.list.type === 'secret') throw badRequest('NOT_FOR_SECRET_LISTS');
    await checkAssignee(access, data.assigneeId);
    if (data.parentId) {
      // Un solo nivel y solo en listas de tareas
      if (!access.list.features.includes('subtasks')) throw badRequest('SUBTASKS_DISABLED');
      const parent = await itemsRepository.find(data.parentId);
      if (!parent || parent.list_id !== listId) throw badRequest('PARENT_NOT_FOUND');
      if (parent.parent_id) throw badRequest('SUBTASK_TOO_DEEP');
    }
    const id = data.id ?? randomUUID();
    const fields = await withRepeat(access, userId, await withDueZone(userId, data));
    const created = await itemsRepository.create(listId, id, userId, { ...fields, text: data.text });
    const item = await itemsRepository.find(id);
    // Reenvío del mismo ítem (cola sin conexión): válido solo si es de esta lista
    if (!created && item?.list_id !== listId) throw conflict('ITEM_ID_TAKEN');
    if (created) {
      await log(access, userId, 'item.created', item!, item!.parent_id ? { subtaskOf: data.parentId } : undefined);
      await syncParent(access, userId, item!.parent_id);
      notificationsService.assigned(item!, access.list, userId, item!.assignee_id);
      if (item!.due_date) calendarService.syncItems([item!.id]);
      // Una subtarea nueva puede reabrir su tarea (el título pierde el ✓)
      if (item!.parent_id) calendarService.syncItems([item!.parent_id]);
    }
    return toItemView(item!);
  },

  async update(listId: string, itemId: string, userId: string, data: ItemFields) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    const before = await getItem(access, itemId);
    await checkAssignee(access, data.assigneeId);
    await itemsRepository.update(itemId, listId, userId, await withRepeat(access, userId, await withDueZone(userId, data, before), before));
    const after = (await itemsRepository.find(itemId))!;

    const columns = {
      text: 'text',
      description: 'description',
      amount: 'amount',
      unit: 'unit',
      category: 'category',
      assigneeId: 'assignee_id',
      dueDate: 'due_date',
      dueTime: 'due_time',
      reminderStartDays: 'reminder_start_days',
      reminderEveryDays: 'reminder_every_days',
      remindersOff: 'reminders_off',
      repeat: 'repeat',
      rotation: 'rotation',
    } as const;
    const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
    const fields = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => !same(before[columns[k]], after[columns[k]]));
    if (fields.length) {
      const details = { fields, ...(fields.includes('text') ? { previousText: before.text } : {}) };
      await log(access, userId, 'item.updated', after, details);
    } else if (before.position !== after.position) {
      await log(access, userId, 'item.moved', after);
    }
    if (after.assignee_id !== before.assignee_id) notificationsService.assigned(after, access.list, userId, after.assignee_id);
    if (before.due_date || after.due_date) calendarService.syncItems([itemId]);
    return toItemView(after);
  },

  /** Marcar y desmarcar: cualquiera que vea la lista (no en modo supervisión) mientras no esté archivada. */
  async setCompleted(listId: string, itemId: string, userId: string, completed: boolean) {
    const access = await getAccess(listId, userId);
    if (!access.canCheck) throw forbidden(access.list.archived_at ? 'LIST_ARCHIVED' : 'LIST_READ_ONLY');
    const before = await getItem(access, itemId);
    // Desmarcar algo ya pagado lo descuenta del movimiento de su pago
    if (!completed && before.spent !== null) await listPaymentsService.onItemsReset(listId, [itemId], userId, access.list.family_id);
    await itemsRepository.setCompleted(itemId, listId, completed, userId);
    // Completar una tarea completa sus subtareas; una subtarea arrastra a su tarea
    const cascaded = completed && !before.parent_id ? await itemsRepository.completeChildren(itemId, userId) : 0;
    const wasDone = completed ? !!before.completed_at : !!before.completed_at || before.purchased !== null;
    // Si se repite, pasa a la siguiente fecha (o queda hecha hasta que vuelva a tocar)
    const next = completed && !wasDone ? await afterDone(access, userId, (await itemsRepository.find(itemId))!) : null;
    if (wasDone !== completed) {
      const details = { ...(cascaded ? { subtasks: cascaded } : {}), ...(next ? { next } : {}) };
      await log(access, userId, completed ? 'item.completed' : 'item.uncompleted', before, Object.keys(details).length ? details : undefined);
    }
    await syncParent(access, userId, before.parent_id);
    // El evento de la tarea, de su tarea principal y de sus subtareas (✓ en el título)
    calendarService.syncItems([itemId, before.parent_id, ...(cascaded ? await childIds(itemId) : [])]);
    return toItemView((await itemsRepository.find(itemId))!);
  },

  /**
   * Compra en una lista de compras: se suma a lo ya comprado. Si alcanza lo pedido queda completo;
   * si no, parcial (sigue pendiente). amount null = lo que faltaba. spent = lo pagado en esta compra.
   */
  async purchase(listId: string, itemId: string, userId: string, data: { id: string; amount?: number | null; spent?: number | null }) {
    const access = await getAccess(listId, userId);
    if (!access.canCheck) throw forbidden(access.list.archived_at ? 'LIST_ARCHIVED' : 'LIST_READ_ONLY');
    if (!access.list.features.includes('purchases')) throw badRequest('PURCHASES_DISABLED');
    const before = await getItem(access, itemId);
    const added = await itemsRepository.addPurchase(itemId, listId, userId, { id: data.id, amount: data.amount ?? null, spent: data.spent ?? null });
    let after = (await itemsRepository.find(itemId))!;
    // Se terminó de comprar algo que se repite: vuelve a la lista en su siguiente fecha
    const next = added && after.completed_at && !before.completed_at ? await afterDone(access, userId, after) : null;
    if (next) after = (await itemsRepository.find(itemId))!;
    if (added) {
      await log(access, userId, 'item.purchased', after, {
        ...(next ? { next } : {}),
        amount: after.amount === null ? null : after.purchased! - (before.purchased ?? 0),
        unit: after.unit,
        total: after.amount === null ? null : after.purchased,
        of: after.amount,
        spent: data.spent ?? null,
        complete: !!after.completed_at,
      });
    }
    return toItemView(after);
  },

  /** Saltar esta vez: pasa a la siguiente fecha sin contarla como hecha (el turno no cambia) */
  async skip(listId: string, itemId: string, userId: string) {
    const access = await getAccess(listId, userId);
    if (!access.canCheck) throw forbidden(access.list.archived_at ? 'LIST_ARCHIVED' : 'LIST_READ_ONLY');
    const item = await getItem(access, itemId);
    if (!item.repeat || !item.due_date || !access.list.features.includes('repeat')) throw badRequest('NOT_REPEATING');
    const user = await usersRepository.findById(userId);
    const next = nextDate(item.repeat, countFrom(item.repeat, item.due_date, todayIn(item.due_tz ?? user?.timezone ?? 'UTC')));
    if (finished(item.repeat, next, item.repeat_done)) throw badRequest('REPEAT_FINISHED');
    // El evento se mueve a la nueva fecha (no queda como hecho)
    await itemsRepository.advance(itemId, listId, { dueDate: next, countDone: false });
    await log(access, userId, 'item.skipped', item, { next });
    calendarService.syncItems([itemId]);
    return toItemView((await itemsRepository.find(itemId))!);
  },

  /** "Mis tareas": lo asignado a la persona en todos sus grupos */
  async assignedTo(userId: string) {
    await reopenDueItems();
    const rows = await itemsRepository.assignedTo(userId);
    return rows.map((r) => ({
      ...toItemView(r),
      list: { id: r.list_id, name: r.list_name, color: r.list_color, icon: r.list_icon },
      family: { id: r.family_id, name: r.family_name },
      parentText: r.parent_text,
    }));
  },

  /** Borrar es idempotente: si ya no existe responde igual (reintentos sin conexión). */
  async remove(listId: string, itemId: string, userId: string): Promise<void> {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    const item = await itemsRepository.find(itemId);
    if (!item) return;
    if (item.list_id !== listId) throw notFound('ITEM_NOT_FOUND');
    const children = await childIds(itemId);
    await itemsRepository.delete(itemId, listId);
    await log(access, userId, 'item.deleted', item);
    await syncParent(access, userId, item.parent_id);
    calendarService.syncItems([itemId, item.parent_id, ...children]);
  },

  async uncheckAll(listId: string, userId: string) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    // Reiniciar la lista borra (o descuenta) los movimientos de sus pagos
    await listPaymentsService.onItemsReset(listId, null, userId, access.list.family_id);
    const count = await itemsRepository.uncheckAll(listId);
    await logActivity(access.list.family_id, userId, 'list.reset', { ...listRef(access.list), details: { count } });
    calendarService.syncList(listId);
    return listsService.detail(listId, userId);
  },

  async deleteCompleted(listId: string, userId: string) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    const count = await itemsRepository.deleteCompleted(listId);
    await logActivity(access.list.family_id, userId, 'list.cleared_completed', { ...listRef(access.list), details: { count } });
    calendarService.syncList(listId);
    return listsService.detail(listId, userId);
  },
};
