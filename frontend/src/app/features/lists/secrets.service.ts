import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SecretField, SecretSummary } from './lists.models';

/**
 * Listas secretas: siempre con conexión, nada se guarda en el dispositivo.
 * El permiso de desbloqueo lo guarda la pantalla en memoria y viaja en el encabezado X-Unlock-Token.
 */
@Injectable({ providedIn: 'root' })
export class SecretsService {
  private readonly http = inject(HttpClient);
  private readonly headers = (token: string | null) => new HttpHeaders(token ? { 'X-Unlock-Token': token } : {});

  async unlock(listId: string, code: string, supervision: boolean): Promise<string> {
    return (await firstValueFrom(this.http.post<{ token: string }>(`/api/lists/${listId}/unlock`, { code, supervision }))).token;
  }

  reveal(listId: string, token: string, supervision: boolean) {
    const params: Record<string, string> = supervision ? { supervision: 'true' } : {};
    return firstValueFrom(
      this.http.get<{ items: { id: string; fields: SecretField[] }[]; token: string }>(`/api/lists/${listId}/secrets`, {
        headers: this.headers(token),
        params,
      }),
    );
  }

  async create(listId: string, title: string, fields: SecretField[]): Promise<SecretSummary> {
    const body = { id: crypto.randomUUID(), title, fields };
    return (await firstValueFrom(this.http.post<{ item: SecretSummary }>(`/api/lists/${listId}/secret-items`, body))).item;
  }

  async update(listId: string, itemId: string, token: string, changes: { title?: string; fields?: SecretField[] }): Promise<SecretSummary> {
    return (
      await firstValueFrom(
        this.http.patch<{ item: SecretSummary }>(`/api/lists/${listId}/secret-items/${itemId}`, changes, { headers: this.headers(token) }),
      )
    ).item;
  }

  remove(listId: string, itemId: string) {
    return firstValueFrom(this.http.delete<void>(`/api/lists/${listId}/secret-items/${itemId}`));
  }

  removeList(listId: string, token: string | null) {
    return firstValueFrom(this.http.delete<void>(`/api/lists/${listId}`, { headers: this.headers(token) }));
  }
}
