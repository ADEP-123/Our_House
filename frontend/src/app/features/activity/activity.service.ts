import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ActivityEntry {
  id: string;
  action: string;
  actor: { id: string | null; nickname: string | null } | null;
  list: { id: string; name: string | null; private: boolean } | null;
  item: { id: string; text: string | null } | null;
  owner: { nickname: string | null } | null;
  details: Record<string, unknown> | null;
  /** Lista privada de alguien no supervisado: sin nombre ni contenido */
  hidden: boolean;
  createdAt: string;
}

export interface ActivityFilters {
  listId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly http = inject(HttpClient);

  page(familyId: string, filters: ActivityFilters, before?: string) {
    const params: Record<string, string> = { limit: '50' };
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
    if (before) params['before'] = before;
    return firstValueFrom(
      this.http.get<{ entries: ActivityEntry[]; nextCursor: string | null }>(`/api/families/${familyId}/activity`, { params }),
    );
  }

  filters(familyId: string) {
    return firstValueFrom(
      this.http.get<{ lists: { id: string; name: string | null }[]; actors: { id: string; nickname: string }[] }>(
        `/api/families/${familyId}/activity/filters`,
      ),
    );
  }
}
