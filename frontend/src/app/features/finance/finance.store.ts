import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { isNetworkError } from '../../core/offline/network';
import { OfflineQueue, QueuedRequest } from '../../core/offline/offline-queue';
import {
  Account,
  AccountMovements,
  Category,
  FamilyAccounts,
  FamilyCategories,
  Movement,
  MovementColumn,
  MovementInput,
  MovementSuggestion,
} from './finance.models';
import { recomputeBalances, withBalance } from './movement-logic';

type FinanceRequest = QueuedRequest & { accountId: string };

const accountsKey = (familyId: string, archived: boolean) =>
  `finance:accounts:${familyId}:${archived ? 'archived' : 'active'}`;
const movementsKey = (accountId: string) => `finance:movements:${accountId}`;
const categoriesKey = (familyId: string) => `finance:categories:${familyId}`;

/**
 * Cuentas, categorías y movimientos con copia en el dispositivo.
 *
 * Sin conexión:
 * - Se ven las cuentas, categorías y movimientos que ya se abrieron.
 * - Agregar, editar, borrar (y deshacer) movimientos, ajustar el saldo y ocultar columnas
 *   se aplican al instante en la copia local (saldos recalculados) y se envían al volver.
 *   Lo agregado sin conexión aparece "sin enviar" y recibe su número (T0007) al sincronizar.
 * - Crear o cambiar cuentas y categorías, y ver el historial, necesitan conexión.
 * - Si dos personas cambian lo mismo, queda el último cambio que llega al servidor.
 */
@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly queue = new OfflineQueue<FinanceRequest>('finance-queue', 'finance');

  /** Sube cada vez que se terminan de enviar los cambios hechos sin conexión */
  readonly synced = this.queue.synced;

  /** Envía ahora los cambios guardados (también se envían solos al volver la conexión y cada 15 s) */
  flush(): Promise<void> {
    return this.queue.flush();
  }

  // ---------- Lecturas ----------

  /** Mientras haya cambios sin enviar, la copia local manda (el servidor aún no los tiene) */
  private async localFirst<T>(
    key: string,
    pending: boolean,
    request: () => Promise<T>,
  ): Promise<T> {
    if (pending) {
      const cached = await this.queue.cached<T>(key);
      if (cached !== undefined) return cached;
    }
    return this.queue.read(key, request);
  }

  accounts(familyId: string, archived = false): Promise<FamilyAccounts> {
    const params: Record<string, string> = archived ? { archived: 'true' } : {};
    return this.localFirst(accountsKey(familyId, archived), !archived && this.queue.has(), () =>
      firstValueFrom(
        this.http.get<FamilyAccounts>(`/api/families/${familyId}/accounts`, { params }),
      ),
    );
  }

  categories(familyId: string): Promise<FamilyCategories> {
    return this.queue.read(categoriesKey(familyId), () =>
      firstValueFrom(this.http.get<FamilyCategories>(`/api/families/${familyId}/categories`)),
    );
  }

  /** La cuenta privada de un supervisado (modo supervisión) no se guarda en el dispositivo */
  movements(accountId: string, supervision = false): Promise<AccountMovements> {
    const request = () =>
      firstValueFrom(
        this.http.get<AccountMovements>(`/api/accounts/${accountId}/movements`, {
          params: supervision ? { supervision: 'true' } : ({} as Record<string, string>),
        }),
      );
    if (supervision) return request();
    return this.localFirst(
      movementsKey(accountId),
      this.queue.has((m) => m.accountId === accountId),
      request,
    );
  }

  /** Descripciones ya usadas; sin conexión, las de la copia local de la cuenta */
  async suggestions(familyId: string, accountId: string, q: string): Promise<MovementSuggestion[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ suggestions: MovementSuggestion[] }>(
          `/api/families/${familyId}/movement-suggestions`,
          { params: { q } },
        ),
      );
      return res.suggestions;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const cached = await this.queue.cached<AccountMovements>(movementsKey(accountId));
      const query = q.trim().toLowerCase();
      const seen = new Set<string>();
      return [...(cached?.movements ?? [])]
        .reverse()
        .filter(
          (m) =>
            (m.kind === 'in' || m.kind === 'out') && m.description.toLowerCase().startsWith(query),
        )
        .filter(
          (m) => !seen.has(m.description.toLowerCase()) && !!seen.add(m.description.toLowerCase()),
        )
        .slice(0, 6)
        .map((m) => ({
          description: m.description,
          kind: m.kind,
          categoryId: m.category?.id ?? null,
        }));
    }
  }

  // ---------- Copia local ----------

  /** Aplica un cambio en los movimientos guardados de la cuenta y actualiza su saldo en la lista de cuentas */
  private async applyLocal(
    account: Account,
    change: (list: Movement[]) => Movement[],
  ): Promise<void> {
    const cached = await this.queue.cached<AccountMovements>(movementsKey(account.id));
    const movements = recomputeBalances(change(cached?.movements ?? []));
    await this.queue.save(movementsKey(account.id), {
      movements,
      hiddenColumns: cached?.hiddenColumns ?? [],
    });
    const balance = movements.reduce((sum, m) => sum + m.signedAmount, 0);
    const key = accountsKey(account.familyId, false);
    const accounts = await this.queue.cached<FamilyAccounts>(key);
    if (accounts) {
      await this.queue.save(key, {
        ...accounts,
        accounts: accounts.accounts.map((a) => (a.id === account.id ? withBalance(a, balance) : a)),
      });
    }
  }

  private me() {
    const user = this.auth.user();
    return user ? { id: user.id, nickname: user.nickname } : null;
  }

  private categoryView(c: Category | null): Movement['category'] {
    return c ? { id: c.id, name: c.name, icon: c.icon, color: c.color } : null;
  }

  // ---------- Cambios (funcionan sin conexión) ----------

  addMovement(
    account: Account,
    input: MovementInput & { id: string },
    category: Category | null,
  ): Promise<void> {
    return this.queue.mutate(
      {
        method: 'POST',
        url: `/api/accounts/${account.id}/movements`,
        body: input,
        accountId: account.id,
      },
      () =>
        this.applyLocal(account, (list) => [
          ...list,
          {
            id: input.id,
            code: '',
            number: 0,
            kind: input.kind,
            amount: input.amount,
            signedAmount: input.kind === 'out' ? -input.amount : input.amount,
            date: input.date,
            description: input.description,
            category: this.categoryView(category),
            createdBy: this.me(),
            edited: false,
            balance: 0,
            createdAt: new Date().toISOString(),
            pending: true,
          },
        ]),
      async () => undefined,
    );
  }

  updateMovement(
    account: Account,
    movement: Movement,
    changes: Partial<Omit<MovementInput, 'id'>>,
    category: Category | null,
  ): Promise<void> {
    return this.queue.mutate(
      {
        method: 'PATCH',
        url: `/api/movements/${movement.id}`,
        body: changes,
        accountId: account.id,
      },
      () =>
        this.applyLocal(account, (list) =>
          list.map((m) => {
            if (m.id !== movement.id) return m;
            const kind = changes.kind ?? m.kind;
            const amount = changes.amount ?? m.amount;
            return {
              ...m,
              ...changes,
              kind,
              amount,
              signedAmount: kind === 'out' ? -amount : amount,
              category: changes.categoryId ? this.categoryView(category) : m.category,
              edited: !m.pending || m.edited,
              pending: true,
            };
          }),
        ),
      async () => undefined,
    );
  }

  deleteMovement(account: Account, movement: Movement): Promise<void> {
    return this.queue.mutate(
      { method: 'DELETE', url: `/api/movements/${movement.id}`, accountId: account.id },
      () => this.applyLocal(account, (list) => list.filter((m) => m.id !== movement.id)),
      async () => undefined,
    );
  }

  /** Deshacer un borrado: sin conexión vuelve el mismo movimiento a la copia local */
  restoreMovement(account: Account, movement: Movement): Promise<void> {
    return this.queue.mutate(
      { method: 'POST', url: `/api/movements/${movement.id}/restore`, accountId: account.id },
      () =>
        this.applyLocal(account, (list) => [
          ...list.filter((m) => m.id !== movement.id),
          { ...movement, pending: true },
        ]),
      async () => undefined,
    );
  }

  /**
   * Ajustar saldo. Se envía el saldo real (no la diferencia): al sincronizar, el servidor
   * ajusta contra su propio saldo, así cuadra aunque otros hayan cambiado la cuenta.
   */
  adjust(
    account: Account,
    input: { id: string; balance: number; date: string; description: string },
  ): Promise<void> {
    return this.queue.mutate(
      {
        method: 'POST',
        url: `/api/accounts/${account.id}/adjust`,
        body: input,
        accountId: account.id,
      },
      () =>
        this.applyLocal(account, (list) => {
          const current = list.reduce((sum, m) => sum + m.signedAmount, 0);
          const diff = Math.round((input.balance - current) * 100) / 100;
          if (diff === 0) return list;
          const adjust: Movement = {
            id: input.id,
            code: '',
            number: 0,
            kind: 'adjust',
            amount: diff,
            signedAmount: diff,
            date: input.date,
            description: input.description,
            category: null,
            createdBy: this.me(),
            edited: false,
            balance: 0,
            createdAt: new Date().toISOString(),
            pending: true,
          };
          return [...list, adjust];
        }),
      async () => undefined,
    );
  }

  setHiddenColumns(accountId: string, hiddenColumns: MovementColumn[]): Promise<void> {
    return this.queue.mutate(
      {
        method: 'PUT',
        url: `/api/accounts/${accountId}/prefs`,
        body: { hiddenColumns },
        accountId,
      },
      async () => {
        const cached = await this.queue.cached<AccountMovements>(movementsKey(accountId));
        if (cached) await this.queue.save(movementsKey(accountId), { ...cached, hiddenColumns });
      },
      async () => undefined,
    );
  }
}
