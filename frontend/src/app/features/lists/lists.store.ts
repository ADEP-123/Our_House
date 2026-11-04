import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { isNetworkError, isRetryable } from '../../core/offline/network';
import { OfflineDb } from '../../core/offline/offline-db.service';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { applyCompleted, applyPurchase } from './item-logic';
import { FamilyLists, ListDetail, ListInput, ListItem, ListSummary } from './lists.models';

export type ItemChanges = Partial<Pick<ListItem, 'text' | 'note' | 'amount' | 'unit' | 'category' | 'assigneeId' | 'dueDate' | 'position'>>;

/** Un cambio guardado en el dispositivo, listo para reenviarse tal cual al servidor */
interface Mutation {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body?: unknown;
  listId: string;
}

const QUEUE_KEY = 'queue';
const listKey = (id: string) => `list:${id}`;
const familyKey = (familyId: string, archived: boolean) => `lists:${familyId}:${archived ? 'archived' : 'active'}`;

/**
 * Único punto de acceso a las listas desde las pantallas.
 *
 * Sin conexión:
 * - Las lecturas devuelven la última copia guardada en el dispositivo.
 * - Marcar, agregar, editar, borrar y reordenar ítems, y crear listas, se aplican al instante
 *   en la copia local y se guardan en una cola. Al volver la conexión se envían en orden.
 * - Los ids los genera el dispositivo, así un reenvío no duplica nada (el servidor lo acepta igual).
 * - Si dos personas cambian lo mismo, queda el último cambio que llega al servidor.
 */
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly http = inject(HttpClient);
  private readonly db = inject(OfflineDb);
  private readonly auth = inject(AuthService);
  private readonly status = inject(SyncStatus);

  /** Peticiones en curso: mientras haya, la actualización automática espera */
  readonly pending = signal(0);
  /** Sube cada vez que la cola termina de enviarse: las pantallas recargan desde el servidor */
  readonly synced = signal(0);

  private queue: Mutation[] = [];
  private readonly ready: Promise<void>;
  /** Los cambios se procesan de a uno, en el orden en que la persona los hizo */
  private chain: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;

  constructor() {
    this.ready = this.db.get<Mutation[]>(QUEUE_KEY).then((saved) => {
      this.queue = saved ?? [];
      this.status.queued.set(this.queue.length);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush());
      setInterval(() => void this.flush(), 15_000);
    }
    void this.ready.then(() => this.flush());
    // Al cerrar sesión se descarta la cola en memoria (la del dispositivo ya se borró)
    effect(() => {
      if (this.auth.user() === null) {
        this.queue = [];
        this.status.queued.set(0);
      }
    });
  }

  // ---------- Infraestructura ----------

  private async track<T>(request: Promise<T>): Promise<T> {
    this.pending.update((n) => n + 1);
    try {
      return await request;
    } finally {
      this.pending.update((n) => n - 1);
    }
  }

  private send<T>(m: Mutation): Promise<T> {
    return firstValueFrom(this.http.request<T>(m.method, m.url, { body: m.body }));
  }

  private async persistQueue(): Promise<void> {
    this.status.queued.set(this.queue.length);
    await this.db.set(QUEUE_KEY, this.queue);
  }

  private async enqueue(m: Mutation): Promise<void> {
    this.queue.push(m);
    await this.persistQueue();
  }

  /** Envía la cola en orden. Se detiene en el primer error que vale la pena reintentar. */
  flush(): Promise<void> {
    this.flushing ??= (async () => {
      await this.ready;
      let sent = false;
      while (this.queue.length) {
        try {
          await this.send(this.queue[0]!);
          sent = true;
        } catch (err) {
          if (isRetryable(err)) {
            if (isNetworkError(err)) this.status.online.set(false);
            return;
          }
          // El servidor lo rechazó (ej. la lista se archivó o cambiaron los permisos): se descarta
          this.status.rejected.update((n) => n + 1);
        }
        this.status.online.set(true);
        this.queue.shift();
        await this.persistQueue();
      }
      if (sent) this.synced.update((n) => n + 1);
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /**
   * Cambio con respaldo sin conexión: si hay cola o no hay red, se aplica en la copia local
   * y se guarda para después; si no, va directo al servidor.
   */
  private mutate<T>(m: Mutation, offline: (m: Mutation) => Promise<T>, online: (res: unknown) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.ready;
      if (!this.queue.length) {
        try {
          const res = await this.track(this.send(m));
          this.status.online.set(true);
          return await online(res);
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          this.status.online.set(false);
        }
      }
      const result = await offline(m);
      await this.enqueue(m);
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Lectura con respaldo: la red primero; sin conexión, la última copia guardada. */
  private async read<T>(key: string, request: () => Promise<T>): Promise<T> {
    try {
      const value = await request();
      this.status.online.set(true);
      await this.db.set(key, value);
      return value;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      this.status.online.set(false);
      const cached = await this.db.get<T>(key);
      if (cached === undefined) throw err;
      return cached;
    }
  }

  /** Actualiza la copia local de una lista y su tarjeta en las listas del grupo. */
  private async updateCached(listId: string, change: (list: ListDetail) => ListDetail): Promise<ListDetail | undefined> {
    const cached = await this.db.get<ListDetail>(listKey(listId));
    if (!cached) return undefined;
    const changed = change(cached);
    const items = changed.items;
    const completed = items.filter((i) => i.completedAt).length;
    const spent = items.reduce((sum, i) => sum + (i.spent ?? 0), 0);
    const updated: ListDetail = {
      ...changed,
      counts: { total: items.length, completed, pending: items.length - completed },
      spent: items.some((i) => i.spent !== null) ? Math.round(spent * 100) / 100 : null,
      updatedAt: new Date().toISOString(),
    };
    await this.db.set(listKey(listId), updated);
    await this.updateCachedCard(updated);
    return updated;
  }

  private async updateCachedCard(list: ListDetail): Promise<void> {
    const key = familyKey(list.familyId, false);
    const cached = await this.db.get<FamilyLists>(key);
    if (!cached) return;
    const { items: _items, ...summary } = list;
    const exists = cached.lists.some((l) => l.id === list.id);
    const lists = exists ? cached.lists.map((l) => (l.id === list.id ? { ...l, ...summary } : l)) : [summary, ...cached.lists];
    await this.db.set(key, { ...cached, lists });
  }

  // ---------- Listas ----------

  async familyLists(familyId: string, archived = false): Promise<FamilyLists> {
    const key = familyKey(familyId, archived);
    // Con cambios aún sin enviar, el servidor no los conoce: se muestra la copia local
    await this.flush();
    if (this.queue.length) {
      const cached = await this.db.get<FamilyLists>(key);
      if (cached) return cached;
    }
    return this.read(key, () =>
      firstValueFrom(
        this.http.get<FamilyLists>(`/api/families/${familyId}/lists`, { params: archived ? { archived: 'true' } : undefined }),
      ),
    );
  }

  async detail(listId: string, supervision = false): Promise<ListDetail> {
    if (supervision) {
      // La vista de supervisión no se guarda en el dispositivo
      const params: Record<string, string> = { supervision: 'true' };
      return (await firstValueFrom(this.http.get<{ list: ListDetail }>(`/api/lists/${listId}`, { params }))).list;
    }
    // Primero se envía lo pendiente, para que el servidor devuelva la lista con esos cambios
    await this.flush();
    if (this.queue.some((m) => m.listId === listId)) {
      const cached = await this.db.get<ListDetail>(listKey(listId));
      if (cached) return cached;
    }
    return this.read(listKey(listId), async () =>
      (await firstValueFrom(this.http.get<{ list: ListDetail }>(`/api/lists/${listId}`))).list,
    );
  }

  /** Se puede crear sin conexión: la lista existe en el dispositivo hasta que se sincroniza. */
  async create(familyId: string, input: ListInput): Promise<ListDetail> {
    const id = crypto.randomUUID();
    const me = this.auth.user();
    const local: ListDetail = {
      id,
      familyId,
      ...input,
      pinned: false,
      archivedAt: null,
      purgeAt: null,
      createdBy: me ? { id: me.id, nickname: me.nickname } : null,
      counts: { total: 0, completed: 0, pending: 0 },
      spent: null,
      currency: (await this.db.get<FamilyLists>(familyKey(familyId, false)))?.lists[0]?.currency ?? 'USD',
      permissions: { canEdit: true, canCheck: true, canChangePrivacy: true, supervision: false },
      updatedAt: new Date().toISOString(),
      items: [],
    };
    return this.mutate(
      { method: 'POST', url: `/api/families/${familyId}/lists`, body: { id, ...input }, listId: id },
      async () => {
        await this.db.set(listKey(id), local);
        await this.updateCachedCard(local);
        return local;
      },
      async (res) => {
        const list = (res as { list: ListDetail }).list;
        await this.db.set(listKey(id), list);
        return list;
      },
    );
  }

  // Estas acciones necesitan conexión (afectan a todo el grupo o requieren confirmación del servidor)

  async update(listId: string, changes: Partial<ListInput>): Promise<ListDetail> {
    return (await firstValueFrom(this.http.patch<{ list: ListDetail }>(`/api/lists/${listId}`, changes))).list;
  }

  async setArchived(listId: string, archived: boolean): Promise<ListDetail> {
    const action = archived ? 'archive' : 'restore';
    return (await firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/lists/${listId}/${action}`, {}))).list;
  }

  remove(listId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/lists/${listId}`));
  }

  async setPinned(listId: string, pinned: boolean): Promise<ListSummary> {
    return (await firstValueFrom(this.http.put<{ list: ListSummary }>(`/api/lists/${listId}/pin`, { pinned }))).list;
  }

  async duplicate(listId: string, name: string): Promise<ListDetail> {
    const body = { id: crypto.randomUUID(), name };
    return (await firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/lists/${listId}/duplicate`, body))).list;
  }

  // ---------- Ítems (funcionan sin conexión) ----------

  private async itemResult(listId: string, res: unknown): Promise<ListItem> {
    const item = (res as { item: ListItem }).item;
    await this.updateCached(listId, (l) => ({ ...l, items: [...l.items.filter((i) => i.id !== item.id), item] }));
    return item;
  }

  async addItem(listId: string, input: ItemChanges & { text: string }): Promise<ListItem> {
    const id = crypto.randomUUID();
    return this.mutate(
      { method: 'POST', url: `/api/lists/${listId}/items`, body: { id, ...input }, listId },
      async (m) => {
        const list = await this.db.get<ListDetail>(listKey(listId));
        const last = Math.max(0, ...(list?.items.map((i) => i.position) ?? []));
        const item: ListItem = {
          id,
          text: input.text,
          note: input.note ?? null,
          amount: input.amount ?? null,
          unit: input.unit ?? null,
          purchased: null,
          spent: null,
          category: input.category ?? null,
          assigneeId: input.assigneeId ?? null,
          dueDate: input.dueDate ?? null,
          position: input.position ?? last + 1,
          completedAt: null,
          completedBy: null,
        };
        // La posición calculada aquí viaja con el ítem, así el orden coincide al sincronizar
        m.body = { ...(m.body as object), position: item.position };
        await this.updateCached(listId, (l) => ({ ...l, items: [...l.items, item] }));
        return item;
      },
      (res) => this.itemResult(listId, res),
    );
  }

  async updateItem(listId: string, itemId: string, changes: ItemChanges): Promise<ListItem> {
    return this.mutate(
      { method: 'PATCH', url: `/api/lists/${listId}/items/${itemId}`, body: changes, listId },
      async () => {
        const updated = await this.updateCached(listId, (l) => ({
          ...l,
          items: l.items.map((i) => (i.id === itemId ? { ...i, ...changes } : i)),
        }));
        return updated?.items.find((i) => i.id === itemId) ?? ({ id: itemId, ...changes } as ListItem);
      },
      (res) => this.itemResult(listId, res),
    );
  }

  async setCompleted(listId: string, itemId: string, completed: boolean): Promise<ListItem> {
    return this.mutate(
      { method: 'PUT', url: `/api/lists/${listId}/items/${itemId}/completed`, body: { completed }, listId },
      () => this.changeCachedItem(listId, itemId, (i) => applyCompleted(i, completed, this.me())),
      (res) => this.itemResult(listId, res),
    );
  }

  /** Compra (se suma a lo ya comprado). El id evita que un reenvío la cuente dos veces. */
  async purchase(listId: string, itemId: string, purchase: { amount: number | null; spent: number | null }): Promise<ListItem> {
    const body = { id: crypto.randomUUID(), ...purchase };
    return this.mutate(
      { method: 'POST', url: `/api/lists/${listId}/items/${itemId}/purchases`, body, listId },
      () => this.changeCachedItem(listId, itemId, (i) => applyPurchase(i, purchase.amount, purchase.spent, this.me())),
      (res) => this.itemResult(listId, res),
    );
  }

  private me() {
    const me = this.auth.user();
    return me ? { id: me.id, nickname: me.nickname } : null;
  }

  /** Cambia un ítem en la copia local. Si la lista no está guardada, no hay nada que mostrar sin conexión. */
  private async changeCachedItem(listId: string, itemId: string, change: (item: ListItem) => ListItem): Promise<ListItem> {
    const updated = await this.updateCached(listId, (l) => ({ ...l, items: l.items.map((i) => (i.id === itemId ? change(i) : i)) }));
    const item = updated?.items.find((i) => i.id === itemId);
    if (!item) throw new Error('ITEM_NOT_CACHED');
    return item;
  }

  deleteItem(listId: string, itemId: string): Promise<void> {
    const removeLocal = async () => {
      await this.updateCached(listId, (l) => ({ ...l, items: l.items.filter((i) => i.id !== itemId) }));
    };
    return this.mutate({ method: 'DELETE', url: `/api/lists/${listId}/items/${itemId}`, listId }, removeLocal, removeLocal);
  }

  async uncheckAll(listId: string): Promise<ListDetail> {
    const list = (await this.track(firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/lists/${listId}/reset`, {})))).list;
    await this.db.set(listKey(listId), list);
    return list;
  }

  async deleteCompleted(listId: string): Promise<ListDetail> {
    const list = (await this.track(firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/lists/${listId}/clear-completed`, {})))).list;
    await this.db.set(listKey(listId), list);
    return list;
  }
}
