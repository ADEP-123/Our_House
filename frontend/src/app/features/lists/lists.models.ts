import type { ListFeature, ListType } from './list-presets';

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
  /** Opciones activas de los elementos */
  features: ListFeature[];
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
  /** 'AAAA-MM-DD' */
  dueDate: string | null;
  /** 'HH:MM' en la zona de quien la puso; null = todo el día */
  dueTime: string | null;
  /** Momento exacto del vencimiento (solo con hora) */
  dueAt: string | null;
  /** Recordatorios por correo: null = los del perfil de quien recibe la tarea */
  reminders: { startDays: number | null; everyDays: number | null; off: boolean };
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
  features: ListFeature[];
  color: string;
  icon: string;
  isPrivate: boolean;
}

/** Tarea asignada a mí (vista "Mis tareas") */
export interface MyTask extends ListItem {
  list: { id: string; name: string; color: string; icon: string };
  family: { id: string; name: string };
  parentText: string | null;
}
