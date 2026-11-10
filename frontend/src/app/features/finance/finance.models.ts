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
  kind: 'opening' | 'in' | 'out';
  amount: number;
  date: string;
  description: string;
}

export type MovementKind = 'opening' | 'in' | 'out' | 'adjust';

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
