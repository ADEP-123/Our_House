import type { ListType } from './list-presets';

export interface ListPermissions {
  canEdit: boolean;
  canCheck: boolean;
  canChangePrivacy: boolean;
  supervision: boolean;
}

export interface ListSummary {
  id: string;
  familyId: string;
  name: string;
  type: ListType;
  color: string;
  icon: string;
  isPrivate: boolean;
  pinned: boolean;
  archivedAt: string | null;
  purgeAt: string | null;
  createdBy: { id: string; nickname: string | null } | null;
  counts: { total: number; completed: number; pending: number };
  /** Total pagado en la lista (compras) y moneda del grupo */
  spent: number | null;
  currency: string;
  permissions: ListPermissions;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  /** Tarea de la que es subtarea (un solo nivel) */
  parentId: string | null;
  text: string;
  note: string | null;
  /** Cantidad pedida (compras) */
  amount: number | null;
  unit: string | null;
  /** Lo comprado hasta ahora: menos que amount = parcial (sigue pendiente) */
  purchased: number | null;
  /** Total pagado por este ítem */
  spent: number | null;
  category: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  completedBy: { id: string; nickname: string | null } | null;
}

export interface ListDetail extends ListSummary {
  items: ListItem[];
}

export interface FamilyLists {
  retentionDays: number;
  lists: ListSummary[];
  supervisedPrivate: { id: string; ownerNickname: string }[];
}

export interface ListInput {
  name: string;
  type: ListType;
  color: string;
  icon: string;
  isPrivate: boolean;
}
