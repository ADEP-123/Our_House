import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { applyPurchase, applyToggle, removeItem, syncParent } from '../lists/item-logic';
import { DEFAULT_FEATURES } from '../lists/list-presets';
import { ListDetail, ListInput, ListItem, RepeatRule } from '../lists/lists.models';
import { ItemChanges, NewItem } from '../lists/lists.store';

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));

/** Siguiente fecha de una tarea que se repite (versión simple de la regla del servidor, para la práctica) */
export function practiceNextDate(rule: RepeatRule, from: string): string {
  const step = Math.max(1, rule.interval);
  if (rule.freq === 'daily') return addDays(from, step);
  if (rule.freq === 'weekly') {
    if (!rule.weekdays?.length) return addDays(from, 7 * step);
    for (let i = 1; i <= 7; i++) {
      const next = addDays(from, i);
      if (rule.weekdays.includes(new Date(`${next}T00:00:00Z`).getUTCDay())) return next;
    }
    return addDays(from, 7);
  }
  const d = new Date(`${from}T00:00:00Z`);
  const months = rule.freq === 'monthly' ? step : 12 * step;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return iso(target);
}

/**
 * Las listas de la práctica: mismos métodos que ListsStore, pero todo en memoria
 * (ni servidor, ni copia en el dispositivo, ni cola sin conexión).
 */
@Injectable()
export class PracticeListsStore {
  private readonly auth = inject(AuthService);
  /** La lista de la práctica (la pantalla la muestra y los pasos la revisan) */
  readonly list = signal<ListDetail | null>(null);
  readonly pending = signal(0);
  readonly synced = signal(0);

  private me() {
    const me = this.auth.user();
    return me ? { id: me.id, nickname: me.nickname } : null;
  }

  /** Lista nueva de práctica, opcionalmente con elementos */
  build(input: ListInput, items: NewItem[] = []): ListDetail {
    const me = this.me();
    const list: ListDetail = {
      id: crypto.randomUUID(),
      familyId: 'practice',
      ...input,
      features: input.features ?? DEFAULT_FEATURES[input.type],
      pinned: false,
      archivedAt: null,
      purgeAt: null,
      createdBy: me,
      counts: { total: 0, completed: 0, pending: 0 },
      spent: null,
      currency: 'USD',
      permissions: { canEdit: true, canCheck: true, canChangePrivacy: true, supervision: false },
      updatedAt: new Date().toISOString(),
      items: [],
    };
    this.list.set(list);
    for (const item of items) this.addLocal(item);
    return this.list()!;
  }

  private setItems(change: (items: ListItem[]) => ListItem[]): ListDetail {
    const list = this.list()!;
    const items = change(list.items);
    const tasks = items.filter((i) => !i.parentId);
    const completed = tasks.filter((i) => i.completedAt).length;
    const next = {
      ...list,
      items,
      counts: { total: tasks.length, completed, pending: tasks.length - completed },
    };
    this.list.set(next);
    return next;
  }

  private addLocal(input: NewItem): ListItem {
    const last = Math.max(0, ...(this.list()?.items.map((i) => i.position) ?? []));
    const item: ListItem = {
      id: crypto.randomUUID(),
      parentId: input.parentId ?? null,
      text: input.text,
      description: input.description ?? null,
      amount: input.amount ?? null,
      unit: input.unit ?? null,
      purchased: null,
      spent: null,
      category: input.category ?? null,
      assigneeId: input.rotation?.[0] ?? input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueDate ? (input.dueTime ?? null) : null,
      dueAt:
        input.dueDate && input.dueTime
          ? new Date(`${input.dueDate}T${input.dueTime}`).toISOString()
          : null,
      reminders: {
        startDays: input.reminderStartDays ?? null,
        everyDays: input.reminderEveryDays ?? null,
        off: input.remindersOff ?? false,
      },
      repeat: input.repeat ?? null,
      repeatDone: 0,
      rotation: input.rotation ?? null,
      reopenOn: null,
      position: input.position ?? last + 1,
      completedAt: null,
      completedBy: null,
    };
    this.setItems((items) => syncParent([...items, item], item.parentId, this.me()));
    return item;
  }

  private find(itemId: string): ListItem {
    return this.list()!.items.find((i) => i.id === itemId)!;
  }

  // ---------- Lo que usan la lista y sus ventanas ----------

  async detail(): Promise<ListDetail> {
    return this.list()!;
  }

  async addItem(_listId: string, input: NewItem): Promise<ListItem> {
    return this.addLocal(input);
  }

  async updateItem(_listId: string, itemId: string, changes: ItemChanges): Promise<ListItem> {
    this.setItems((items) =>
      items.map((i) =>
        i.id === itemId
          ? {
              ...i,
              ...changes,
              assigneeId:
                changes.rotation?.length && !changes.rotation.includes(i.assigneeId ?? '')
                  ? changes.rotation[0]!
                  : (changes.assigneeId ?? i.assigneeId),
            }
          : i,
      ),
    );
    return this.find(itemId);
  }

  async setCompleted(_listId: string, itemId: string, completed: boolean): Promise<ListItem> {
    this.setItems((items) => applyToggle(items, itemId, completed, this.me()));
    const item = this.find(itemId);
    // Lo que se repite pasa a su siguiente fecha (y al siguiente turno), como en el servidor
    if (completed && item.repeat && item.dueDate) return this.roll(item);
    return item;
  }

  private roll(item: ListItem): ListItem {
    const next = practiceNextDate(item.repeat!, item.dueDate!);
    const rotation = item.rotation ?? [];
    const turn = rotation.length
      ? rotation[(rotation.indexOf(item.assigneeId ?? '') + 1) % rotation.length]!
      : item.assigneeId;
    this.setItems((items) =>
      items.map((i) =>
        i.id === item.id
          ? {
              ...i,
              dueDate: next,
              dueAt: null,
              completedAt: null,
              completedBy: null,
              purchased: null,
              spent: null,
              repeatDone: i.repeatDone + 1,
              assigneeId: turn,
            }
          : i.parentId === item.id
            ? { ...i, completedAt: null, completedBy: null }
            : i,
      ),
    );
    return this.find(item.id);
  }

  async purchase(
    _listId: string,
    itemId: string,
    purchase: { amount: number | null; spent: number | null },
  ): Promise<ListItem> {
    this.setItems((items) =>
      items.map((i) =>
        i.id === itemId ? applyPurchase(i, purchase.amount, purchase.spent, this.me()) : i,
      ),
    );
    return this.find(itemId);
  }

  async skip(_listId: string, itemId: string): Promise<ListItem> {
    const item = this.find(itemId);
    const next = practiceNextDate(item.repeat!, item.dueDate!);
    this.setItems((items) =>
      items.map((i) => (i.id === itemId ? { ...i, dueDate: next, dueAt: null } : i)),
    );
    return this.find(itemId);
  }

  async deleteItem(_listId: string, itemId: string): Promise<void> {
    this.setItems((items) => removeItem(items, itemId, this.me()));
  }

  async uncheckAll(): Promise<ListDetail> {
    return this.setItems((items) =>
      items.map((i) => ({
        ...i,
        completedAt: null,
        completedBy: null,
        purchased: null,
        spent: null,
      })),
    );
  }

  async deleteCompleted(): Promise<ListDetail> {
    return this.setItems((items) => {
      const done = new Set(items.filter((i) => i.completedAt && !i.parentId).map((i) => i.id));
      return items.filter((i) => !done.has(i.id) && !done.has(i.parentId ?? ''));
    });
  }

  async suggestions(): Promise<string[]> {
    return [];
  }
}
