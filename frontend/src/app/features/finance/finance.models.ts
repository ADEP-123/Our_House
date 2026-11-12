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
