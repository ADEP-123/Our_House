import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DebtEntryInput, DebtHistoryEntry, DebtInput, DebtsData } from './finance.models';

/** Deudas del grupo (necesitan conexión). */
@Injectable({ providedIn: 'root' })
export class DebtsService {
  private readonly http = inject(HttpClient);

  list(familyId: string): Promise<DebtsData> {
    return firstValueFrom(this.http.get<DebtsData>(`/api/families/${familyId}/debts`));
  }

  create(familyId: string, input: DebtInput): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`/api/families/${familyId}/debts`, input));
  }

  update(id: string, input: DebtInput): Promise<unknown> {
    const { id: _, ...body } = input;
    return firstValueFrom(this.http.put(`/api/debts/${id}`, body));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/debts/${id}`));
  }

  async history(id: string): Promise<DebtHistoryEntry[]> {
    return (
      await firstValueFrom(
        this.http.get<{ history: DebtHistoryEntry[] }>(`/api/debts/${id}/history`),
      )
    ).history;
  }

  addEntry(id: string, input: DebtEntryInput): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/debts/${id}/entries`, input));
  }

  removeEntry(entryId: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/debts/entries/${entryId}`));
  }
}
