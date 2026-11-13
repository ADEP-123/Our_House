import { FamilyRole } from '../families/families.service';

export type AccountKind = 'bank' | 'cash' | 'credit' | 'savings';
export type ViewMode = 'family' | 'members' | 'private';
export type EditMode = 'roles' | 'members';

export interface Account {
  id: string;
  familyId: string;
  name: string;
  description: string | null;
  kind: AccountKind;
  prefix: string;
  currency: string;
  balance: number;
  /** Solo tarjetas de crédito */
  credit: { limit: number; debt: number; available: number; overLimit: boolean } | null;
  /** En tarjetas, la deuda inicial va en negativo. number: número del movimiento (para su ID visible) */
  opening: { amount: number; date: string; number: number } | null;
  /** Saldo · Ahorro · Disponible: lo apartado para proyectos de ahorro */
  savings: AccountSavings;
  /** Aviso cuando el disponible baja de este monto */
  lowBalanceThreshold: number | null;
  viewMode: ViewMode;
  editMode: EditMode;
  editRoles: FamilyRole[];
  viewers: string[];
  editors: string[];
  owner: { id: string; nickname: string | null } | null;
  archivedAt: string | null;
  createdAt: string;
  permissions: { canEdit: boolean; canAdmin: boolean; supervision: boolean };
}

export interface AccountSavings {
  total: number;
  available: number;
  projects: { id: string; name: string; icon: string; amount: number }[];
}

export interface FamilyAccounts {
  currency: string;
  accounts: Account[];
  /** Cuentas privadas de supervisados (solo líderes): sin nombre hasta confirmar el aviso */
  supervisedPrivate: { id: string; ownerNickname: string | null }[];
}

export interface AccountInput {
  id?: string;
  name: string;
  description: string | null;
  kind: AccountKind;
  prefix: string;
  creditLimit: number | null;
  opening: { amount: number; date: string } | null;
  viewMode: ViewMode;
  editMode: EditMode;
  editRoles: FamilyRole[];
  viewers: string[];
  editors: string[];
  lowBalanceThreshold?: number | null;
}

/** Categoría de los movimientos (el "Tipo" del Excel), del grupo */
export interface Category {
  id: string;
  name: string;
  icon: string;
  /** Uno de los colores de las listas */
  color: string;
  /** No se ofrece al crear movimientos; sigue en el resumen y los filtros */
  disabled: boolean;
  /** Movimientos con esta categoría */
  usage: number;
}

export interface FamilyCategories {
  canManage: boolean;
  categories: Category[];
}

export interface CategoryInput {
  name: string;
  icon: string;
  color: string;
}

/** Movimiento que usa una categoría (para elegir a dónde pasarlo al borrarla) */
export interface CategoryMovement {
  id: string;
  account: { id: string; name: string };
  code: string;
  kind: MovementKind;
  amount: number;
  date: string;
  description: string;
}

export type MovementKind = 'opening' | 'in' | 'out' | 'adjust' | 'transfer_in' | 'transfer_out';

/** Columnas de la tabla de una cuenta (cada persona puede ocultar las que quiera, menos la descripción) */
export type MovementColumn =
  'code' | 'date' | 'description' | 'category' | 'amount' | 'balance' | 'createdBy';

export interface Movement {
  id: string;
  /** ID visible: prefijo + número (T0001) */
  code: string;
  number: number;
  kind: MovementKind;
  amount: number;
  /** Con signo: las salidas en negativo */
  signedAmount: number;
  date: string;
  description: string;
  category: { id: string; name: string; icon: string; color: string } | null;
  createdBy: { id: string; nickname: string | null } | null;
  edited: boolean;
  /** Saldo de la cuenta hasta este movimiento */
  balance: number;
  createdAt: string;
  /** Hecho sin conexión: todavía no llegó al servidor (aún sin número) */
  pending?: boolean;
  /** Transferencia: la otra cuenta (nombre e ID solo si la persona la ve) */
  transfer?: {
    id: string;
    accountId: string | null;
    accountName: string | null;
    code: string | null;
  } | null;
  /** Salida pagada con el ahorro de un proyecto */
  savings?: { id: string; name: string | null; icon: string | null } | null;
  /** Creado por un movimiento programado */
  scheduled?: boolean;
  /** Creado con "Registrar pago" de una lista de compras */
  purchase?: boolean;
}

/** Transferencia entre dos cuentas; los ids los genera el dispositivo (funciona sin conexión) */
export interface TransferInput {
  id: string;
  outId: string;
  inId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string;
}

export interface AccountMovements {
  movements: Movement[];
  hiddenColumns: MovementColumn[];
}

export interface MovementInput {
  id?: string;
  kind: 'in' | 'out';
  amount: number;
  date: string;
  description: string;
  categoryId: string;
  /** Pagar con el ahorro de este proyecto (solo salidas) */
  savingsProjectId?: string | null;
}

export interface MovementSuggestion {
  description: string;
  kind: MovementKind;
  categoryId: string | null;
}

export interface MovementHistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted' | 'restored';
  changes: Partial<
    Record<'kind' | 'amount' | 'date' | 'description' | 'category', [unknown, unknown]>
  > | null;
  actor: { id: string; nickname: string | null } | null;
  at: string;
}

// ---------- Resumen ----------

export type SummaryFreq = 'week' | 'month' | 'quarter' | 'year';
export type SummaryView = 'combined' | 'separate' | 'both';

/** Lo que cada persona elige en el resumen (se recuerda en el servidor) */
export interface SummaryConfig {
  mode: 'month' | 'year' | 'range';
  /** AAAA-MM */
  month?: string;
  year?: number;
  from?: string;
  to?: string;
  freq: SummaryFreq;
  /** Vacío: todas las cuentas activas */
  accounts: string[];
  view: SummaryView;
}

export interface SummaryFlow {
  income: number;
  expense: number;
  net: number;
  adjustments: number;
  transfersIn: number;
  transfersOut: number;
}

export interface SummaryPeriod extends SummaryFlow {
  start: string;
  end: string;
  /** Saldo al cierre del período */
  balance: number;
  categories: Record<string, { income: number; expense: number }>;
}

export interface SummaryBlock extends SummaryFlow {
  previous: SummaryFlow;
  openingBalance: number;
  closingBalance: number;
  categories: {
    id: string;
    name: string | null;
    icon: string | null;
    color: string | null;
    income: number;
    expense: number;
  }[];
  periods: SummaryPeriod[];
}

export interface Summary {
  currency: string;
  from: string;
  to: string;
  freq: SummaryFreq;
  previous: { from: string; to: string };
  available: { id: string; name: string; kind: AccountKind; archived: boolean }[];
  accounts: { id: string; name: string; kind: AccountKind }[];
  balances: { debt: number; real: number; complete: number };
  combined: SummaryBlock;
  byAccount: (SummaryBlock & { accountId: string })[];
}

// ---------- Importar / exportar (formato v1) ----------

export type IoKind = 'in' | 'out' | 'transfer' | 'opening' | 'adjust';

/** Lo que devuelve /export: movimientos de las cuentas elegidas, sus cuentas y las categorías */
export interface ExportData {
  currency: string;
  from: string | null;
  to: string | null;
  accounts: {
    name: string;
    prefix: string;
    kind: AccountKind;
    description: string | null;
    creditLimit: number | null;
    balance: number;
    archived: boolean;
  }[];
  categories: { name: string; icon: string; color: string; active: boolean }[];
  movements: {
    code: string;
    /** null: la cuenta de origen de una transferencia que la persona no ve */
    account: string | null;
    date: string;
    description: string;
    category: string | null;
    kind: IoKind;
    amount: number;
    destination: string | null;
  }[];
}

export interface ImportAccountRow {
  row: number;
  name: string;
  prefix: string | null;
  kind: AccountKind;
  description: string | null;
  creditLimit: number | null;
}

export interface ImportCategoryRow {
  row: number;
  name: string;
  icon: string | null;
  color: string | null;
  active: boolean | null;
}

export interface ImportMovementRow {
  row: number;
  code: string | null;
  account: string;
  date: string;
  description: string;
  category: string | null;
  kind: IoKind;
  amount: number;
  destination: string | null;
}

export interface ImportPayload {
  accounts: ImportAccountRow[];
  categories: ImportCategoryRow[];
  movements: ImportMovementRow[];
}

export type ImportStatus = 'create' | 'update' | 'unchanged' | 'skipped' | 'error';

export interface ImportRowResult {
  row: number;
  status: ImportStatus;
  code?: string;
  params?: Record<string, string | number>;
  ref?: string;
  changes?: Record<string, [unknown, unknown]>;
}

export type ImportCounts = Record<ImportStatus, number>;

export interface ImportReport {
  dryRun: boolean;
  currency: string;
  counts: { accounts: ImportCounts; categories: ImportCounts; movements: ImportCounts };
  accounts: ImportRowResult[];
  categories: ImportRowResult[];
  movements: ImportRowResult[];
}

// ---------- Ahorros y presupuesto ----------

export interface SavingsProject {
  id: string;
  name: string;
  icon: string;
  goal: number | null;
  targetDate: string | null;
  closedAt: string | null;
  createdBy: { id: string; nickname: string | null } | null;
  canManage: boolean;
  /** Apartado hoy (sin lo gastado) */
  saved: number;
  /** Gastado del ahorro */
  spent: number;
  /** accountId null: lo apartado en cuentas que la persona no ve */
  accounts: { accountId: string | null; name: string | null; amount: number }[];
}

export interface SavingsData {
  currency: string;
  projects: SavingsProject[];
  /** Cuentas donde se puede apartar (no tarjetas) */
  accounts: { id: string; name: string; kind: AccountKind; balance: number; saved: number; available: number; canEdit: boolean }[];
}

export interface SavingsProjectInput {
  id?: string;
  name: string;
  icon: string;
  goal: number | null;
  targetDate: string | null;
}

export interface SavingsHistoryEntry {
  kind: 'set_aside' | 'release' | 'spend';
  amount: number;
  account: { id: string; name: string } | null;
  actor: { id: string; nickname: string | null } | null;
  description: string | null;
  date: string | null;
  at: string;
}

export interface Budget {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  disabled: boolean;
  limit: number;
  spent: number;
  pct: number;
}

export interface BudgetsData {
  month: string;
  canManage: boolean;
  budgets: Budget[];
}

// ---------- Movimientos programados ----------

export type ScheduledKind = 'in' | 'out' | 'transfer' | 'set_aside';

export interface ScheduledRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  weekdays?: number[];
  /** Primera fecha (fija el día del mes o de la semana) */
  start: string;
  until?: string | null;
  count?: number | null;
}

export interface Scheduled {
  id: string;
  kind: ScheduledKind;
  account: { id: string; name: string };
  /** Transferencias: la cuenta destino (sin nombre si la persona no la ve) */
  toAccount: { id: string; name: string | null } | null;
  category: { id: string; name: string | null; icon: string | null; color: string | null } | null;
  project: { id: string; name: string | null; icon: string | null } | null;
  amount: number;
  description: string;
  mode: 'auto' | 'confirm';
  rule: ScheduledRule;
  nextDate: string | null;
  timesDone: number;
  remindDays: number | null;
  notifyDone: boolean;
  paused: { reason: 'manual' | 'archived' | 'permission' | 'missing' } | null;
  ended: boolean;
  canManage: boolean;
  createdBy: { id: string; nickname: string | null } | null;
}

export interface ScheduledPending {
  id: string;
  scheduleId: string;
  dueDate: string;
  amount: number | null;
}

export interface ScheduledData {
  currency: string;
  items: Scheduled[];
  pending: ScheduledPending[];
}

export interface ScheduledInput {
  id?: string;
  accountId: string;
  kind: ScheduledKind;
  toAccountId: string | null;
  savingsProjectId: string | null;
  categoryId: string | null;
  amount: number;
  description: string;
  mode: 'auto' | 'confirm';
  rule: ScheduledRule;
  remindDays: number | null;
  notifyDone: boolean;
}

export interface UpcomingItem {
  scheduleId: string;
  date: string;
  kind: ScheduledKind;
  amount: number;
  description: string;
  mode: 'auto' | 'confirm';
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
}

export interface ScheduledSuggestion {
  accountId: string;
  accountName: string;
  description: string;
  categoryId: string | null;
  amount: number;
  day: number;
  months: number;
}
