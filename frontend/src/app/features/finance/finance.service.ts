import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Account,
  AccountInput,
  Category,
  CategoryInput,
  CategoryMovement,
  FamilyAccounts,
  FamilyCategories,
} from './finance.models';

/** Cuentas del módulo de finanzas (solo con conexión). */
@Injectable({ providedIn: 'root' })
export class FinanceService {
  private readonly http = inject(HttpClient);

  accounts(familyId: string, archived = false): Promise<FamilyAccounts> {
    return firstValueFrom(
      this.http.get<FamilyAccounts>(`/api/families/${familyId}/accounts`, {
        params: archived ? { archived: 'true' } : ({} as Record<string, string>),
      }),
    );
  }

  /** @param supervision el líder confirmó el aviso para ver la cuenta privada de un supervisado */
  async account(id: string, supervision = false): Promise<Account> {
    const params: Record<string, string> = supervision ? { supervision: 'true' } : {};
    return (
      await firstValueFrom(this.http.get<{ account: Account }>(`/api/accounts/${id}`, { params }))
    ).account;
  }

  async create(familyId: string, input: AccountInput): Promise<Account> {
    return (
      await firstValueFrom(
        this.http.post<{ account: Account }>(`/api/families/${familyId}/accounts`, input),
      )
    ).account;
  }

  async update(id: string, input: AccountInput): Promise<Account> {
    return (await firstValueFrom(this.http.put<{ account: Account }>(`/api/accounts/${id}`, input)))
      .account;
  }

  async setArchived(id: string, archived: boolean): Promise<Account> {
    const action = archived ? 'archive' : 'restore';
    return (
      await firstValueFrom(
        this.http.post<{ account: Account }>(`/api/accounts/${id}/${action}`, {}),
      )
    ).account;
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/accounts/${id}`));
  }

  // ---------- Categorías ----------

  categories(familyId: string): Promise<FamilyCategories> {
    return firstValueFrom(this.http.get<FamilyCategories>(`/api/families/${familyId}/categories`));
  }

  async createCategory(familyId: string, input: CategoryInput): Promise<Category> {
    return (
      await firstValueFrom(
        this.http.post<{ category: Category }>(`/api/families/${familyId}/categories`, input),
      )
    ).category;
  }

  async updateCategory(
    id: string,
    changes: Partial<CategoryInput> & { disabled?: boolean },
  ): Promise<Category> {
    return (
      await firstValueFrom(
        this.http.patch<{ category: Category }>(`/api/categories/${id}`, changes),
      )
    ).category;
  }

  categoryMovements(id: string): Promise<{ movements: CategoryMovement[]; hiddenCount: number }> {
    return firstValueFrom(
      this.http.get<{ movements: CategoryMovement[]; hiddenCount: number }>(
        `/api/categories/${id}/movements`,
      ),
    );
  }

  /** moveTo: a dónde pasan todos sus movimientos; overrides: destino de movimientos puntuales */
  deleteCategory(
    id: string,
    moveTo: string | null,
    overrides: { movementId: string; categoryId: string }[] = [],
  ): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/categories/${id}/delete`, { moveTo, overrides }));
  }
}
