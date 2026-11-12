import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ScheduledData, ScheduledInput, ScheduledSuggestion } from './finance.models';

/** Movimientos programados (necesitan conexión, salvo lo que FinanceStore guarda para leer). */
@Injectable({ providedIn: 'root' })
export class ScheduledService {
  private readonly http = inject(HttpClient);

  list(familyId: string): Promise<ScheduledData> {
    return firstValueFrom(this.http.get<ScheduledData>(`/api/families/${familyId}/scheduled`));
  }

  create(familyId: string, input: ScheduledInput): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>(`/api/families/${familyId}/scheduled`, input),
    );
  }

  update(id: string, input: ScheduledInput): Promise<unknown> {
    const { id: _, ...body } = input;
    return firstValueFrom(this.http.put(`/api/scheduled/${id}`, body));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/scheduled/${id}`));
  }

  action(id: string, action: 'pause' | 'resume' | 'skip'): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/scheduled/${id}/${action}`, {}));
  }

  confirm(occurrenceId: string, amount: number, date?: string): Promise<unknown> {
    return firstValueFrom(
      this.http.post(`/api/scheduled/occurrences/${occurrenceId}/confirm`, {
        amount,
        ...(date ? { date } : {}),
      }),
    );
  }

  dismiss(occurrenceId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/scheduled/occurrences/${occurrenceId}/dismiss`, {}));
  }

  async suggestions(familyId: string): Promise<ScheduledSuggestion[]> {
    return (
      await firstValueFrom(
        this.http.get<{ suggestions: ScheduledSuggestion[] }>(
          `/api/families/${familyId}/scheduled/suggestions`,
        ),
      )
    ).suggestions;
  }
}
