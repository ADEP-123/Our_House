import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FamilyLists, ListDetail, ListInput, ListSummary } from './lists.models';

/**
 * Único punto de acceso a las listas desde las pantallas.
 * (El modo sin conexión se agrega aquí, sin tocar los componentes.)
 */
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly http = inject(HttpClient);

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
}
