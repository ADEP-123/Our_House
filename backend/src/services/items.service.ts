import { randomUUID } from 'node:crypto';
import { db } from '../config/database.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/http-error.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { itemsRepository, type ItemFields } from '../repositories/items.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { listRef, logActivity } from './activity.service.js';
import { getAccess, listsService, requireEdit, toItemView, type ListAccess } from './lists.service.js';
import { calendarService } from './calendar.service.js';
import { notificationsService } from './notifications.service.js';

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

async function childIds(itemId: string): Promise<string[]> {
  return (await db().query<{ id: string }>('SELECT id FROM list_items WHERE parent_id = $1', [itemId])).rows.map((r) => r.id);
}

/** Después de cambiar una subtarea, la tarea se completa o vuelve a pendiente según corresponda. */
async function syncParent(access: ListAccess, userId: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const change = await itemsRepository.syncParent(parentId, userId);
  if (change) await log(access, userId, change === 'completed' ? 'item.completed' : 'item.uncompleted', (await itemsRepository.find(parentId))!, { bySubtasks: true });
}

export const itemsService = {
  async create(listId: string, userId: string, data: ItemFields & { id?: string; text: string }) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    await checkAssignee(access, data.assigneeId);
    if (data.parentId) {
      // Un solo nivel y solo en listas de tareas
      if (!access.list.features.includes('subtasks')) throw badRequest('SUBTASKS_DISABLED');
      const parent = await itemsRepository.find(data.parentId);
      if (!parent || parent.list_id !== listId) throw badRequest('PARENT_NOT_FOUND');
      if (parent.parent_id) throw badRequest('SUBTASK_TOO_DEEP');
    }
    const id = data.id ?? randomUUID();
    const created = await itemsRepository.create(listId, id, userId, { ...(await withDueZone(userId, data)), text: data.text });
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
    await itemsRepository.update(itemId, listId, userId, await withDueZone(userId, data, before));
    const after = (await itemsRepository.find(itemId))!;

    const columns = {
      text: 'text',
      note: 'note',
      amount: 'amount',
      unit: 'unit',
      category: 'category',
      assigneeId: 'assignee_id',
      dueDate: 'due_date',
      dueTime: 'due_time',
      reminderStartDays: 'reminder_start_days',
      reminderEveryDays: 'reminder_every_days',
      remindersOff: 'reminders_off',
    } as const;
    const fields = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => before[columns[k]] !== after[columns[k]]);
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
    await itemsRepository.setCompleted(itemId, listId, completed, userId);
    // Completar una tarea completa sus subtareas; una subtarea arrastra a su tarea
    const cascaded = completed && !before.parent_id ? await itemsRepository.completeChildren(itemId, userId) : 0;
    const wasDone = completed ? !!before.completed_at : !!before.completed_at || before.purchased !== null;
    if (wasDone !== completed) {
      await log(access, userId, completed ? 'item.completed' : 'item.uncompleted', before, cascaded ? { subtasks: cascaded } : undefined);
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
    const after = (await itemsRepository.find(itemId))!;
    if (added) {
      await log(access, userId, 'item.purchased', after, {
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

  /** "Mis tareas": lo asignado a la persona en todos sus grupos */
  async assignedTo(userId: string) {
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
