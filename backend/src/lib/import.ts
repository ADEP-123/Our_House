/**
 * Importar finanzas (formato v1): decide qué hacer con cada fila del archivo sin tocar la base.
 * La misma función arma la vista previa y, dentro de la transacción, lo que se guarda.
 *
 * Reglas:
 * - ID existente en la cuenta: actualiza ese movimiento. ID libre (con el prefijo de la cuenta): se crea con ese número.
 *   Sin ID: se crea con el siguiente número. Lo que no viene en el archivo no se borra.
 * - Entrada y Salida llevan categoría y monto positivo; Saldo inicial y Ajuste, monto con signo y sin categoría;
 *   Transferencia, monto positivo y cuenta destino (crea la salida y la entrada).
 * - Hoja Cuentas: crea las que no existen (quien importa queda como dueño); las que existen no se tocan.
 * - Hoja Categorías: solo la aplica un líder. Si importa otra persona, una categoría desconocida es un error.
 * - Las filas con error se saltan; el resto se aplica.
 */

export type ImportKind = 'in' | 'out' | 'transfer' | 'opening' | 'adjust';
export type DbKind = 'opening' | 'in' | 'out' | 'adjust' | 'transfer_in' | 'transfer_out';
export type AccountKind = 'bank' | 'cash' | 'credit' | 'savings';

export interface ImportAccountRow {
  row: number;
  name: string;
  prefix?: string | null;
  kind: AccountKind;
  description?: string | null;
  creditLimit?: number | null;
}

export interface ImportCategoryRow {
  row: number;
  name: string;
  icon?: string | null;
  color?: string | null;
  active?: boolean | null;
}

export interface ImportMovementRow {
  row: number;
  code?: string | null;
  account: string;
  date: string;
  description: string;
  category?: string | null;
  kind: ImportKind;
  amount: number;
  destination?: string | null;
}

export interface ImportInput {
  accounts: ImportAccountRow[];
  categories: ImportCategoryRow[];
  movements: ImportMovementRow[];
}

export interface StateAccount {
  id: string;
  name: string;
  prefix: string;
  kind: AccountKind;
  lastNumber: number;
  visible: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  archived: boolean;
}

export interface StateCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  disabled: boolean;
}

export interface StateMovement {
  id: string;
  accountId: string;
  number: number;
  kind: DbKind;
  amount: number;
  date: string;
  description: string;
  categoryId: string | null;
  transferId: string | null;
  deleted: boolean;
}

export interface ImportState {
  isLeader: boolean;
  accounts: StateAccount[];
  categories: StateCategory[];
  movements: StateMovement[];
}

export type RowStatus = 'create' | 'update' | 'unchanged' | 'skipped' | 'error';

export interface RowResult {
  row: number;
  status: RowStatus;
  /** Código de error o de aviso */
  code?: string;
  params?: Record<string, string | number>;
  /** ID visible que queda (T0005; en transferencias, "T0005 → E0003") */
  ref?: string;
  /** Actualizaciones: { campo: [antes, después] } */
  changes?: Record<string, [unknown, unknown]>;
}

export interface NewMovement {
  id: string;
  accountId: string;
  number: number;
  kind: DbKind;
  amount: number;
  date: string;
  description: string;
  categoryId: string | null;
  transferId: string | null;
}

export interface MovementUpdate {
  id: string;
  kind: DbKind;
  amount: number;
  date: string;
  description: string;
  categoryId: string | null;
  changes: Record<string, [unknown, unknown]>;
}

export interface ImportPlan {
  accounts: RowResult[];
  categories: RowResult[];
  movements: RowResult[];
  newAccounts: { id: string; name: string; prefix: string; kind: AccountKind; description: string | null; creditLimit: number | null }[];
  newCategories: { id: string; name: string; icon: string; color: string; disabled: boolean }[];
  categoryUpdates: { id: string; icon?: string; color?: string; disabled?: boolean }[];
  newMovements: NewMovement[];
  movementUpdates: MovementUpdate[];
  /** Mayor número usado en cada cuenta (last_number no baja nunca) */
  lastNumbers: Map<string, number>;
}

export const IMPORT_LIMITS = { accounts: 50, categories: 200, movements: 5000 } as const;

const key = (s: string) => s.trim().toLocaleLowerCase();
const r2 = (n: number) => Math.round(n * 100) / 100;
const codeOf = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}`;

/** Prefijo libre a partir del nombre: iniciales (o dos primeras letras) y un número si ya existe */
export function suggestPrefix(name: string, taken: Set<string>): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const base = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? 'C').slice(0, 2)) || 'C';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 4 - String(i).length)}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

interface PlanAccount {
  id: string;
  name: string;
  prefix: string;
  canEdit: boolean;
  canAdmin: boolean;
  archived: boolean;
  lastNumber: number;
  isNew: boolean;
}

export function planImport(input: ImportInput, state: ImportState, newId: () => string): ImportPlan {
  const plan: ImportPlan = {
    accounts: [],
    categories: [],
    movements: [],
    newAccounts: [],
    newCategories: [],
    categoryUpdates: [],
    newMovements: [],
    movementUpdates: [],
    lastNumbers: new Map(),
  };

  // ---------- Cuentas ----------
  const accountsByName = new Map<string, PlanAccount>();
  for (const a of state.accounts) {
    if (!a.visible || accountsByName.has(key(a.name))) continue;
    accountsByName.set(key(a.name), { ...a, isNew: false });
  }
  const prefixes = new Set(state.accounts.map((a) => a.prefix));
  for (const r of input.accounts) {
    const existing = accountsByName.get(key(r.name));
    if (existing) {
      plan.accounts.push({ row: r.row, status: existing.isNew ? 'error' : 'unchanged', ...(existing.isNew ? { code: 'IMPORT_ACCOUNT_DUPLICATE', params: { name: r.name } } : { ref: existing.prefix }) });
      continue;
    }
    if (r.kind === 'credit' && r.creditLimit == null) {
      plan.accounts.push({ row: r.row, status: 'error', code: 'CREDIT_LIMIT_REQUIRED' });
      continue;
    }
    const prefix = r.prefix?.trim().toUpperCase() || suggestPrefix(r.name, prefixes);
    if (!/^[A-Z0-9]{1,4}$/.test(prefix)) {
      plan.accounts.push({ row: r.row, status: 'error', code: 'ACCOUNT_PREFIX_INVALID' });
      continue;
    }
    if (prefixes.has(prefix)) {
      plan.accounts.push({ row: r.row, status: 'error', code: 'ACCOUNT_PREFIX_TAKEN', params: { prefix } });
      continue;
    }
    prefixes.add(prefix);
    const id = newId();
    plan.newAccounts.push({
      id,
      name: r.name.trim(),
      prefix,
      kind: r.kind,
      description: r.description?.trim() || null,
      creditLimit: r.kind === 'credit' ? r.creditLimit! : null,
    });
    accountsByName.set(key(r.name), { id, name: r.name.trim(), prefix, canEdit: true, canAdmin: true, archived: false, lastNumber: 0, isNew: true });
    plan.accounts.push({ row: r.row, status: 'create', ref: prefix });
  }

  // ---------- Categorías ----------
  const categoriesByName = new Map(state.categories.map((c) => [key(c.name), c]));
  const categoryNames = new Map(state.categories.map((c) => [c.id, c.name]));
  for (const r of input.categories) {
    if (!state.isLeader) {
      plan.categories.push({ row: r.row, status: 'skipped', code: 'IMPORT_CATEGORIES_LEADER_ONLY' });
      continue;
    }
    const existing = categoriesByName.get(key(r.name));
    if (existing && plan.newCategories.some((c) => c.id === existing.id)) {
      plan.categories.push({ row: r.row, status: 'error', code: 'IMPORT_CATEGORY_DUPLICATE', params: { name: r.name } });
      continue;
    }
    if (existing) {
      const update: ImportPlan['categoryUpdates'][number] = { id: existing.id };
      const changes: Record<string, [unknown, unknown]> = {};
      if (r.icon && r.icon !== existing.icon) (update.icon = r.icon), (changes.icon = [existing.icon, r.icon]);
      if (r.color && r.color !== existing.color) (update.color = r.color), (changes.color = [existing.color, r.color]);
      if (r.active != null && r.active === existing.disabled) (update.disabled = !r.active), (changes.active = [!existing.disabled, r.active]);
      if (Object.keys(changes).length) {
        plan.categoryUpdates.push(update);
        plan.categories.push({ row: r.row, status: 'update', changes });
      } else plan.categories.push({ row: r.row, status: 'unchanged' });
      continue;
    }
    const created = { id: newId(), name: r.name.trim(), icon: r.icon || '📦', color: r.color || 'gray', disabled: r.active === false };
    plan.newCategories.push(created);
    categoriesByName.set(key(r.name), { ...created });
    categoryNames.set(created.id, created.name);
    plan.categories.push({ row: r.row, status: 'create' });
  }

  // ---------- Movimientos ----------
  const movementsByCode = new Map<string, StateMovement>(); // "<cuenta>:<número>"
  const pairs = new Map<string, StateMovement[]>();
  const openings = new Map<string, StateMovement>();
  for (const m of state.movements) {
    movementsByCode.set(`${m.accountId}:${m.number}`, m);
    if (m.transferId) pairs.set(m.transferId, [...(pairs.get(m.transferId) ?? []), m]);
    if (m.kind === 'opening') openings.set(m.accountId, m);
  }
  const accountsById = new Map([...accountsByName.values()].map((a) => [a.id, a]));
  const usedNumbers = new Map<string, Set<number>>(); // números reservados en este archivo
  const touched = new Set<string>(); // movimientos existentes ya actualizados por otra fila
  const openingRows = new Set<string>();
  const reserve = (accountId: string, n: number) => {
    const set = usedNumbers.get(accountId) ?? new Set<number>();
    set.add(n);
    usedNumbers.set(accountId, set);
    plan.lastNumbers.set(accountId, Math.max(plan.lastNumbers.get(accountId) ?? 0, n));
  };

  /** Creaciones sin ID: el número se asigna al final, después de los IDs explícitos */
  const pending: { result: RowResult; movement: NewMovement; account: PlanAccount; partner?: { movement: NewMovement; account: PlanAccount } }[] = [];

  const fail = (row: number, code: string, params?: RowResult['params']) => plan.movements.push({ row, status: 'error', code, ...(params ? { params } : {}) });

  for (const r of input.movements) {
    const account = accountsByName.get(key(r.account));
    if (!account) {
      fail(r.row, 'IMPORT_ACCOUNT_NOT_FOUND', { name: r.account });
      continue;
    }
    if (!account.canEdit) {
      fail(r.row, account.archived ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY', { name: account.name });
      continue;
    }
    const amount = r2(r.amount);
    const signedKind = r.kind === 'opening' || r.kind === 'adjust';
    if (signedKind ? amount === 0 : amount <= 0) {
      fail(r.row, signedKind ? 'MOVEMENT_AMOUNT_INVALID' : 'IMPORT_AMOUNT_POSITIVE');
      continue;
    }

    // Categoría: solo en entradas y salidas
    let categoryId: string | null = null;
    if (r.kind === 'in' || r.kind === 'out') {
      if (!r.category?.trim()) {
        fail(r.row, 'CATEGORY_REQUIRED');
        continue;
      }
      const category = categoriesByName.get(key(r.category));
      if (!category) {
        fail(r.row, 'IMPORT_CATEGORY_NOT_FOUND', { name: r.category });
        continue;
      }
      categoryId = category.id;
    }

    // Cuenta destino: solo en transferencias
    let destination: PlanAccount | null = null;
    if (r.kind === 'transfer') {
      if (!r.destination?.trim()) {
        fail(r.row, 'IMPORT_DESTINATION_REQUIRED');
        continue;
      }
      destination = accountsByName.get(key(r.destination)) ?? null;
      if (!destination) {
        fail(r.row, 'IMPORT_ACCOUNT_NOT_FOUND', { name: r.destination });
        continue;
      }
      if (destination.id === account.id) {
        fail(r.row, 'TRANSFER_SAME_ACCOUNT');
        continue;
      }
      if (!destination.canEdit) {
        fail(r.row, destination.archived ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY', { name: destination.name });
        continue;
      }
    }
    if (r.kind === 'opening' && !account.canAdmin) {
      fail(r.row, 'ACCOUNT_ADMIN_ONLY', { name: account.name });
      continue;
    }

    // ID: prefijo de la cuenta + número
    let number: number | null = null;
    const code = r.code?.trim().toUpperCase();
    if (code) {
      const match = /^([A-Z0-9]+?)(\d+)$/.exec(code);
      if (!match || match[1] !== account.prefix || Number(match[2]) <= 0) {
        fail(r.row, 'IMPORT_CODE_PREFIX', { code, prefix: account.prefix });
        continue;
      }
      number = Number(match[2]);
      if (usedNumbers.get(account.id)?.has(number)) {
        fail(r.row, 'IMPORT_CODE_DUPLICATE', { code });
        continue;
      }
    }

    // El saldo inicial es uno por cuenta: sin ID se cambia el que ya existe
    if (r.kind === 'opening') {
      if (openingRows.has(account.id)) {
        fail(r.row, 'IMPORT_OPENING_DUPLICATE', { name: account.name });
        continue;
      }
      const current = openings.get(account.id);
      if (current && number !== null && number !== current.number) {
        fail(r.row, 'IMPORT_OPENING_CODE', { code: codeOf(account.prefix, current.number) });
        continue;
      }
      if (current) number = current.number;
      openingRows.add(account.id);
    }

    const existing = number !== null ? movementsByCode.get(`${account.id}:${number}`) : undefined;
    if (existing) {
      if (existing.deleted) {
        fail(r.row, 'IMPORT_CODE_DELETED', { code: codeOf(account.prefix, number!) });
        continue;
      }
      if (touched.has(existing.id)) {
        fail(r.row, 'IMPORT_CODE_DUPLICATE', { code: codeOf(account.prefix, number!) });
        continue;
      }
      const sameFamily =
        (r.kind === 'in' || r.kind === 'out') === (existing.kind === 'in' || existing.kind === 'out') &&
        (r.kind !== 'transfer' || existing.kind === 'transfer_out') &&
        (r.kind !== 'opening' || existing.kind === 'opening') &&
        (r.kind !== 'adjust' || existing.kind === 'adjust');
      if (!sameFamily) {
        fail(r.row, 'IMPORT_KIND_FIXED', { code: codeOf(account.prefix, number!) });
        continue;
      }
      const nextKind: DbKind = r.kind === 'transfer' ? 'transfer_out' : r.kind;
      const next = { kind: nextKind, amount, date: r.date, description: r.description.trim(), categoryId };
      const changes: Record<string, [unknown, unknown]> = {};
      if (next.kind !== existing.kind) changes.kind = [existing.kind, next.kind];
      if (next.amount !== r2(existing.amount)) changes.amount = [r2(existing.amount), next.amount];
      if (next.date !== existing.date) changes.date = [existing.date, next.date];
      if (next.description !== existing.description) changes.description = [existing.description, next.description];
      if (next.categoryId !== existing.categoryId)
        changes.category = [existing.categoryId ? (categoryNames.get(existing.categoryId) ?? null) : null, categoryNames.get(next.categoryId!) ?? null];

      const ref = codeOf(account.prefix, number!);
      let updates: MovementUpdate[] = [{ id: existing.id, ...next, changes }];
      let resultRef = ref;
      if (r.kind === 'transfer') {
        const partner = (pairs.get(existing.transferId!) ?? []).find((m) => m.id !== existing.id);
        if (!partner || partner.accountId !== destination!.id) {
          fail(r.row, 'TRANSFER_FIELDS_FIXED');
          continue;
        }
        const partnerChanges = { ...changes };
        delete partnerChanges.kind;
        updates = [
          { id: existing.id, ...next, changes: partnerChanges },
          { id: partner.id, kind: 'transfer_in', amount, date: r.date, description: next.description, categoryId: null, changes: partnerChanges },
        ];
        touched.add(partner.id);
        resultRef = `${ref} → ${codeOf(destination!.prefix, partner.number)}`;
      }
      touched.add(existing.id);
      reserve(account.id, number!);
      if (!Object.keys(changes).length) {
        plan.movements.push({ row: r.row, status: 'unchanged', ref: resultRef });
        continue;
      }
      plan.movementUpdates.push(...updates);
      plan.movements.push({ row: r.row, status: 'update', ref: resultRef, changes });
      continue;
    }

    // Nuevo
    const transferId = r.kind === 'transfer' ? newId() : null;
    const movement: NewMovement = {
      id: newId(),
      accountId: account.id,
      number: number ?? 0,
      kind: r.kind === 'transfer' ? 'transfer_out' : r.kind,
      amount,
      date: r.date,
      description: r.description.trim(),
      categoryId,
      transferId,
    };
    const result: RowResult = { row: r.row, status: 'create' };
    plan.movements.push(result);
    if (number !== null) reserve(account.id, number);
    const partner = destination
      ? {
          movement: { ...movement, id: newId(), accountId: destination.id, number: 0, kind: 'transfer_in' as const },
          account: destination,
        }
      : undefined;
    pending.push({ result, movement, account, ...(partner ? { partner } : {}) });
  }

  // Números: los IDs del archivo ya quedaron reservados; el resto sigue después del mayor
  const next = new Map<string, number>();
  const nextNumber = (a: PlanAccount) => {
    let n = Math.max(next.get(a.id) ?? 0, a.lastNumber, plan.lastNumbers.get(a.id) ?? 0) + 1;
    while (usedNumbers.get(a.id)?.has(n) || movementsByCode.has(`${a.id}:${n}`)) n++;
    next.set(a.id, n);
    reserve(a.id, n);
    return n;
  };
  // Primero todos los explícitos llevan su número; después los demás en el orden del archivo
  for (const p of pending) {
    if (!p.movement.number) p.movement.number = nextNumber(p.account);
    plan.newMovements.push(p.movement);
    p.result.ref = codeOf(p.account.prefix, p.movement.number);
    if (p.partner) {
      p.partner.movement.number = nextNumber(p.partner.account);
      plan.newMovements.push(p.partner.movement);
      p.result.ref += ` → ${codeOf(p.partner.account.prefix, p.partner.movement.number)}`;
    }
  }
  // last_number de cuentas que existían: nunca baja
  for (const [id, n] of plan.lastNumbers) {
    const a = accountsById.get(id);
    if (a && a.lastNumber >= n) plan.lastNumbers.delete(id);
  }

  plan.movements.sort((a, b) => a.row - b.row);
  return plan;
}

/** Totales por estado para la vista previa */
export function countStatuses(results: RowResult[]): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { create: 0, update: 0, unchanged: 0, skipped: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  return counts;
}
