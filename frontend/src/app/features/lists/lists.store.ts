import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FamilyLists, ListDetail, ListInput, ListItem, ListSummary } from './lists.models';

export type ItemChanges = Partial<Pick<ListItem, 'text' | 'note' | 'quantity' | 'category' | 'assigneeId' | 'dueDate' | 'position'>>;

/**
 * Único punto de acceso a las listas desde las pantallas.
 * (El modo sin conexión se agrega aquí, sin tocar los componentes.)
 */
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly http = inject(HttpClient);
  /** Cambios enviados que aún no responden: mientras haya, la actualización automática espera */
  readonly pending = signal(0);

  private async track<T>(request: Promise<T>): Promise<T> {
    this.pending.update((n) => n + 1);
    try {
      return await request;
    } finally {
      this.pending.update((n) => n - 1);
    }
  }

  familyLists(familyId: string, archived = false): Promise<FamilyLists> {
    return firstValueFrom(
      this.http.get<FamilyLists>(`/api/families/${familyId}/lists`, { params: archived ? { archived: 'true' } : undefined }),
    );
  }

  async detail(listId: string, supervision = false): Promise<ListDetail> {
    const params: Record<string, string> = supervision ? { supervision: 'true' } : {};
    return (await firstValueFrom(this.http.get<{ list: ListDetail }>(`/api/lists/${listId}`, { params }))).list;
  }

  async create(familyId: string, input: ListInput): Promise<ListDetail> {
    const body = { id: crypto.randomUUID(), ...input };
    return (await firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/families/${familyId}/lists`, body))).list;
  }

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

  // ---------- Ítems ----------

  async addItem(listId: string, item: ItemChanges & { text: string }): Promise<ListItem> {
    const body = { id: crypto.randomUUID(), ...item };
    return (await this.track(firstValueFrom(this.http.post<{ item: ListItem }>(`/api/lists/${listId}/items`, body)))).item;
  }

  async updateItem(listId: string, itemId: string, changes: ItemChanges): Promise<ListItem> {
    return (await this.track(firstValueFrom(this.http.patch<{ item: ListItem }>(`/api/lists/${listId}/items/${itemId}`, changes)))).item;
  }

  async setCompleted(listId: string, itemId: string, completed: boolean): Promise<ListItem> {
    const url = `/api/lists/${listId}/items/${itemId}/completed`;
    return (await this.track(firstValueFrom(this.http.put<{ item: ListItem }>(url, { completed })))).item;
  }

  deleteItem(listId: string, itemId: string): Promise<void> {
    return this.track(firstValueFrom(this.http.delete<void>(`/api/lists/${listId}/items/${itemId}`)));
  }

  async uncheckAll(listId: string): Promise<ListDetail> {
    return (await this.track(firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/lists/${listId}/reset`, {})))).list;
  }

  async deleteCompleted(listId: string): Promise<ListDetail> {
    return (await this.track(firstValueFrom(this.http.post<{ list: ListDetail }>(`/api/lists/${listId}/clear-completed`, {})))).list;
  }
}
