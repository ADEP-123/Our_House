import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { isNetworkError } from '../../core/offline/network';
import { OfflineQueue, QueuedRequest } from '../../core/offline/offline-queue';
import {
  Account,
  AccountMovements,
  BudgetsData,
  Category,
  FamilyAccounts,
  FamilyCategories,
  Movement,
  MovementColumn,
  MovementInput,
  MovementSuggestion,
  Summary,
  SummaryConfig,
  SummaryFreq,
  TransferInput,
} from './finance.models';
import { recomputeBalances, signOf, withBalance } from './movement-logic';

/** accountIds: cuentas que el cambio toca (una transferencia toca dos) */
type FinanceRequest = QueuedRequest & { accountIds: string[] };

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
      this.queue.has((m) => m.accountIds.includes(accountId)),
      request,
    );
  }

  /** Resumen del período (sin conexión: el último que se vio con esas mismas opciones) */
  summary(
    familyId: string,
    q: { from: string; to: string; freq: SummaryFreq; accounts: string[] },
  ): Promise<Summary> {
    const params: Record<string, string> = { from: q.from, to: q.to, freq: q.freq };
    if (q.accounts.length) params['accounts'] = q.accounts.join(',');
    const key = `finance:summary:${familyId}:${q.from}:${q.to}:${q.freq}:${q.accounts.join(',')}`;
    return this.queue.read(key, () =>
      firstValueFrom(this.http.get<Summary>(`/api/families/${familyId}/summary`, { params })),
    );
  }

  async summaryPrefs(familyId: string): Promise<SummaryConfig | null> {
    const res = await this.queue.read(`finance:summary-prefs:${familyId}`, () =>
      firstValueFrom(
        this.http.get<{ config: SummaryConfig | null }>(`/api/families/${familyId}/summary/prefs`),
      ),
    );
    return res.config;
  }

  /** Recordar la configuración (sin conexión se guarda solo en el dispositivo) */
  async saveSummaryPrefs(familyId: string, config: SummaryConfig): Promise<void> {
    await this.queue.save(`finance:summary-prefs:${familyId}`, { config });
    await firstValueFrom(
      this.http.put(`/api/families/${familyId}/summary/prefs`, { config }),
    ).catch(() => undefined);
  }

  /**
   * Presupuestos del mes con lo gastado (sin conexión: lo último que se vio).
   * Sin mes: el actual en la zona de la persona.
   */
  budgets(familyId: string, month?: string): Promise<BudgetsData> {
    const params: Record<string, string> = month ? { month } : {};
    return this.queue.read(`finance:budgets:${familyId}:${month ?? 'current'}`, () =>
      firstValueFrom(this.http.get<BudgetsData>(`/api/families/${familyId}/budgets`, { params })),
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
    account: Pick<Account, 'id' | 'familyId'>,
    change: (list: Movement[]) => Movement[],
  ): Promise<void> {
    const cached = await this.queue.cached<AccountMovements>(movementsKey(account.id));
    const before = cached?.movements ?? [];
    const after = recomputeBalances(change(before));
    // Sin copia de esa cuenta (nunca se abrió en este dispositivo) solo se mueve su saldo
    if (cached)
      await this.queue.save(movementsKey(account.id), {
        movements: after,
        hiddenColumns: cached.hiddenColumns,
      });
    const sum = (list: Movement[]) => list.reduce((total, m) => total + m.signedAmount, 0);
    const delta = sum(after) - sum(before);
    const key = accountsKey(account.familyId, false);
    const accounts = await this.queue.cached<FamilyAccounts>(key);
    if (!accounts || !delta) return;
    await this.queue.save(key, {
      ...accounts,
      accounts: accounts.accounts.map((a) =>
        a.id === account.id ? withBalance(a, a.balance + delta) : a,
      ),
    });
  }

  /** La otra cuenta de una transferencia (si la persona la ve) */
  private counterpart(
    account: Account,
    movement: Movement,
  ): Pick<Account, 'id' | 'familyId'> | null {
    const id = movement.transfer?.accountId;
    return id ? { id, familyId: account.familyId } : null;
  }

  /** Mitades borradas sin conexión, para poder deshacer (vale mientras la app esté abierta) */
  private readonly removedHalves = new Map<string, Movement>();

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
        accountIds: [account.id],
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
            signedAmount: signOf(input.kind, input.amount),
            date: input.date,
            description: input.description,
            category: this.categoryView(category),
            savings: this.savingsView(account, input.savingsProjectId),
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
    const other = this.counterpart(account, movement);
    const apply = (m: Movement): Movement => {
      const kind = changes.kind ?? m.kind;
      const amount = changes.amount ?? m.amount;
      return {
        ...m,
        ...changes,
        kind,
        amount,
        signedAmount: signOf(kind, amount),
        category: changes.categoryId ? this.categoryView(category) : m.category,
        savings:
          changes.savingsProjectId === undefined
            ? m.savings
            : this.savingsView(account, changes.savingsProjectId),
        edited: !m.pending || m.edited,
        pending: true,
      };
    };
    return this.queue.mutate(
      {
        method: 'PATCH',
        url: `/api/movements/${movement.id}`,
        body: changes,
        accountIds: [account.id, ...(other ? [other.id] : [])],
      },
      async () => {
        await this.applyLocal(account, (list) =>
          list.map((m) => (m.id === movement.id ? apply(m) : m)),
        );
        // La otra mitad: mismo monto, fecha y descripción
        if (other) {
          await this.applyLocal(other, (list) =>
            list.map((m) => {
              if (m.transfer?.id !== movement.transfer?.id || m.id === movement.id) return m;
              const amount = changes.amount ?? m.amount;
              const date = changes.date ?? m.date;
              const description = changes.description ?? m.description;
              return {
                ...m,
                amount,
                date,
                description,
                signedAmount: signOf(m.kind, amount),
                edited: true,
                pending: true,
              };
            }),
          );
        }
      },
      async () => undefined,
    );
  }

  /** Proyecto de ahorro de una salida, para mostrarlo en la copia local */
  private savingsView(account: Account, projectId: string | null | undefined): Movement['savings'] {
    if (!projectId) return null;
    const p = account.savings?.projects.find((x) => x.id === projectId);
    return { id: projectId, name: p?.name ?? null, icon: p?.icon ?? null };
  }

  deleteMovement(account: Account, movement: Movement): Promise<void> {
    const other = this.counterpart(account, movement);
    return this.queue.mutate(
      {
        method: 'DELETE',
        url: `/api/movements/${movement.id}`,
        accountIds: [account.id, ...(other ? [other.id] : [])],
      },
      async () => {
        await this.applyLocal(account, (list) => list.filter((m) => m.id !== movement.id));
        if (other) {
          await this.applyLocal(other, (list) =>
            list.filter((m) => {
              const half = m.transfer?.id === movement.transfer?.id && m.id !== movement.id;
              if (half) this.removedHalves.set(movement.id, m);
              return !half;
            }),
          );
        }
      },
      async () => undefined,
    );
  }

  /** Deshacer un borrado: sin conexión vuelve el mismo movimiento (y su otra mitad) a la copia local */
  restoreMovement(account: Account, movement: Movement): Promise<void> {
    const other = this.counterpart(account, movement);
    return this.queue.mutate(
      {
        method: 'POST',
        url: `/api/movements/${movement.id}/restore`,
        accountIds: [account.id, ...(other ? [other.id] : [])],
      },
      async () => {
        await this.applyLocal(account, (list) => [
          ...list.filter((m) => m.id !== movement.id),
          { ...movement, pending: true },
        ]);
        const half = this.removedHalves.get(movement.id);
        if (other && half) {
          await this.applyLocal(other, (list) => [
            ...list.filter((m) => m.id !== half.id),
            { ...half, pending: true },
          ]);
          this.removedHalves.delete(movement.id);
        }
      },
      async () => undefined,
    );
  }

  /** Transferir entre dos cuentas (también pagar una tarjeta) */
  transfer(from: Account, to: Account, input: TransferInput): Promise<void> {
    const half = (id: string, kind: 'transfer_in' | 'transfer_out', other: Account): Movement => ({
      id,
      code: '',
      number: 0,
      kind,
      amount: input.amount,
      signedAmount: signOf(kind, input.amount),
      date: input.date,
      description: input.description,
      category: null,
      createdBy: this.me(),
      edited: false,
      balance: 0,
      createdAt: new Date().toISOString(),
      pending: true,
      transfer: { id: input.id, accountId: other.id, accountName: other.name, code: null },
    });
    return this.queue.mutate(
      { method: 'POST', url: '/api/transfers', body: input, accountIds: [from.id, to.id] },
      async () => {
        await this.applyLocal(from, (list) => [...list, half(input.outId, 'transfer_out', to)]);
        await this.applyLocal(to, (list) => [...list, half(input.inId, 'transfer_in', from)]);
      },
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
        accountIds: [account.id],
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
        accountIds: [accountId],
      },
      async () => {
        const cached = await this.queue.cached<AccountMovements>(movementsKey(accountId));
        if (cached) await this.queue.save(movementsKey(accountId), { ...cached, hiddenColumns });
      },
      async () => undefined,
    );
  }
}
