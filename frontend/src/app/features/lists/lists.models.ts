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
  permissions: ListPermissions;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  text: string;
  note: string | null;
  quantity: string | null;
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
