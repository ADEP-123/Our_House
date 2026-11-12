import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SavingsData, SavingsHistoryEntry, SavingsProjectInput } from './finance.models';

/** Proyectos de ahorro y presupuesto mensual (necesitan conexión). */
@Injectable({ providedIn: 'root' })
export class SavingsService {
  private readonly http = inject(HttpClient);

  list(familyId: string): Promise<SavingsData> {
    return firstValueFrom(this.http.get<SavingsData>(`/api/families/${familyId}/savings`));
  }

  create(familyId: string, input: SavingsProjectInput): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>(`/api/families/${familyId}/savings`, input),
    );
  }

  update(id: string, input: SavingsProjectInput): Promise<unknown> {
    const { id: _, ...body } = input;
    return firstValueFrom(this.http.put(`/api/savings/${id}`, body));
  }

  close(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/savings/${id}/close`, {}));
  }

  reopen(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/savings/${id}/reopen`, {}));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/savings/${id}`));
  }

  /** Apartar o liberar dinero de una cuenta */
  move(
    id: string,
    accountId: string,
    action: 'set_aside' | 'release',
    amount: number,
  ): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/savings/${id}/move`, { accountId, action, amount }));
  }

  async history(id: string): Promise<SavingsHistoryEntry[]> {
    return (
      await firstValueFrom(
        this.http.get<{ history: SavingsHistoryEntry[] }>(`/api/savings/${id}/history`),
      )
    ).history;
  }

  /** amount null: quitar el presupuesto de la categoría */
  setBudget(categoryId: string, amount: number | null): Promise<unknown> {
    return firstValueFrom(this.http.put(`/api/categories/${categoryId}/budget`, { amount }));
  }
}
