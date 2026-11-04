import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../config/database.js';
import { env } from '../config/env.js';
import { conflict, forbidden, notFound } from '../lib/http-error.js';
import { familiesRepository, type FamilyRole } from '../repositories/families.repository.js';
import { listsRepository, type ItemRow, type ListCardRow } from '../repositories/lists.repository.js';
import { listRef, logActivity } from './activity.service.js';
import { notificationsService } from './notifications.service.js';
import { activityRepository } from '../repositories/activity.repository.js';
import { requireMember } from './families.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Qué puede hacer el usuario con una lista.
 * - Ver: las del grupo, o la propia si es privada. Un líder ve las privadas de los supervisados (solo lectura).
 * - Editar (nombre, ítems, archivar…): quien la creó, o un líder si la lista es del grupo.
 * - Marcar ítems: cualquiera que la vea normalmente (no en modo supervisión) mientras no esté archivada.
 * - Cambiar privacidad: solo quien la creó.
 */
export interface ListAccess {
  list: ListCardRow;
  role: FamilyRole;
  supervision: boolean;
  canEdit: boolean;
  canCheck: boolean;
  canChangePrivacy: boolean;
}

/**
 * @param supervision el líder confirmó el aviso de privacidad para ver la lista privada de un supervisado
 */
export async function getAccess(listId: string, userId: string, supervision = false, conn?: Db): Promise<ListAccess> {
  const list = await listsRepository.findCard(listId, userId, conn);
  if (!list) throw notFound('LIST_NOT_FOUND');
  const role = await familiesRepository.getRole(list.family_id, userId, conn);
  if (!role) throw notFound('LIST_NOT_FOUND');

  const isOwner = list.created_by === userId;
  if (list.is_private && !isOwner) {
    const canSupervise = role === 'leader' && list.creator_role === 'supervised';
    if (!canSupervise) throw notFound('LIST_NOT_FOUND');
    if (!supervision) throw forbidden('SUPERVISION_CONFIRMATION_REQUIRED');
    return { list, role, supervision: true, canEdit: false, canCheck: false, canChangePrivacy: false };
  }

  const archived = !!list.archived_at;
  const canManage = isOwner || (role === 'leader' && !list.is_private);
  return {
    list,
    role,
    supervision: false,
    canEdit: canManage && !archived,
    canCheck: !archived,
    canChangePrivacy: isOwner && !archived,
  };
}

/** Para archivar, restaurar o borrar: mismas personas que pueden editar, sin importar si está archivada. */
export function requireManage(access: ListAccess, userId: string): void {
  const { list, role, supervision } = access;
  const ok = !supervision && (list.created_by === userId || (role === 'leader' && !list.is_private));
  if (!ok) throw forbidden('LIST_READ_ONLY');
}

export function requireEdit(access: ListAccess): void {
  if (!access.canEdit) throw forbidden(access.list.archived_at ? 'LIST_ARCHIVED' : 'LIST_READ_ONLY');
}

export function toListView(list: ListCardRow, access?: Pick<ListAccess, 'canEdit' | 'canCheck' | 'canChangePrivacy' | 'supervision'>) {
  return {
    id: list.id,
    familyId: list.family_id,
    name: list.name,
    type: list.type,
    color: list.color,
    icon: list.icon,
    isPrivate: list.is_private,
    pinned: list.pinned,
    archivedAt: list.archived_at,
    // Fecha en que se borrará definitivamente si sigue archivada
    purgeAt: list.archived_at ? new Date(list.archived_at.getTime() + env.listArchiveRetentionDays * DAY_MS) : null,
    createdBy: list.created_by ? { id: list.created_by, nickname: list.creator_nickname } : null,
    counts: { total: list.total, completed: list.completed, pending: list.total - list.completed },
    spent: list.spent,
    currency: list.currency,
    permissions: access
      ? { canEdit: access.canEdit, canCheck: access.canCheck, canChangePrivacy: access.canChangePrivacy, supervision: access.supervision }
      : undefined,
    updatedAt: list.updated_at,
  };
}

export function toItemView(item: ItemRow) {
  return {
    id: item.id,
    text: item.text,
    note: item.note,
    amount: item.amount,
    unit: item.unit,
    purchased: item.purchased,
    spent: item.spent,
    category: item.category,
    assigneeId: item.assignee_id,
    dueDate: item.due_date,
    position: item.position,
    completedAt: item.completed_at,
    completedBy: item.completed_by ? { id: item.completed_by, nickname: item.completed_by_nickname } : null,
  };
}

/** Permisos de cada tarjeta sin consultar lista por lista. */
function cardAccess(list: ListCardRow, role: FamilyRole, userId: string) {
  const isOwner = list.created_by === userId;
  const archived = !!list.archived_at;
  const canManage = isOwner || (role === 'leader' && !list.is_private);
  return { canEdit: canManage && !archived, canCheck: !archived, canChangePrivacy: isOwner && !archived, supervision: false };
}

export const listsService = {
  async listForFamily(familyId: string, userId: string, archived: boolean) {
    const role = await requireMember(familyId, userId);
    await listsService.purgeExpired(familyId);
    const lists = await listsRepository.listForFamily(familyId, userId, archived);
    const supervisedPrivate =
      role === 'leader' && !archived ? await listsRepository.supervisedPrivate(familyId, userId) : [];
    return {
      retentionDays: env.listArchiveRetentionDays,
      lists: lists.map((l) => toListView(l, cardAccess(l, role, userId))),
      // Solo el dueño: el nombre y el contenido se revelan después del aviso de privacidad
      supervisedPrivate: supervisedPrivate.map((l) => ({ id: l.id, ownerNickname: l.owner_nickname })),
    };
  },

  /** Borrado definitivo de las archivadas vencidas. Se ejecuta al consultar las listas del grupo. */
  async purgeExpired(familyId: string) {
    const purged = await listsRepository.purgeArchived(familyId, env.listArchiveRetentionDays);
    for (const list of purged) {
      await logActivity(familyId, null, 'list.purged', { ...listRef(list), details: { days: env.listArchiveRetentionDays } });
    }
    return purged;
  },

  async create(
    familyId: string,
    userId: string,
    data: { id?: string; name: string; type: string; color: string; icon: string; isPrivate: boolean },
  ) {
    await requireMember(familyId, userId);
    const id = data.id ?? randomUUID();
    const created = await listsRepository.create({ ...data, id, familyId, userId });
    if (!created) {
      // Mismo id reenviado (cola sin conexión): devuelve la existente si es de este usuario y grupo
      const existing = await listsRepository.findCard(id, userId);
      if (!existing || existing.family_id !== familyId || existing.created_by !== userId) throw conflict('LIST_ID_TAKEN');
    } else {
      const card = (await listsRepository.findCard(id, userId))!;
      await logActivity(familyId, userId, 'list.created', { ...listRef(card), details: { type: card.type } });
      if (!card.is_private) notificationsService.listShared(card, userId, false);
    }
    return listsService.detail(id, userId);
  },

  async detail(listId: string, userId: string, supervision = false) {
    const access = await getAccess(listId, userId, supervision);
    if (access.supervision) {
      // Queda en la bitácora; con la actualización cada 15 s se registra como máximo cada 30 minutos
      const seen = await activityRepository.recentExists(access.list.family_id, userId, 'list.viewed_private', listId, 30);
      if (!seen) await logActivity(access.list.family_id, userId, 'list.viewed_private', listRef(access.list));
    }
    const items = await listsRepository.items(listId);
    return { ...toListView(access.list, access), items: items.map(toItemView) };
  },

  async update(listId: string, userId: string, data: { name?: string; color?: string; icon?: string; isPrivate?: boolean }) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    if (data.isPrivate !== undefined && data.isPrivate !== access.list.is_private && !access.canChangePrivacy) {
      throw forbidden('ONLY_CREATOR_CHANGES_PRIVACY');
    }
    await listsRepository.update(listId, data);

    const before = access.list;
    const changes: Record<string, { from: string; to: string }> = {};
    for (const key of ['name', 'color', 'icon'] as const) {
      if (data[key] !== undefined && data[key] !== before[key]) changes[key] = { from: before[key], to: data[key]! };
    }
    const ref = listRef({ ...before, name: data.name ?? before.name });
    if (Object.keys(changes).length) await logActivity(before.family_id, userId, 'list.updated', { ...ref, details: { changes } });
    if (data.isPrivate !== undefined && data.isPrivate !== before.is_private) {
      // Visible para los líderes: el nombre era (o pasa a ser) del grupo
      await logActivity(before.family_id, userId, 'list.privacy_changed', { ...ref, privateOwnerId: null, details: { isPrivate: data.isPrivate } });
      if (!data.isPrivate) notificationsService.listShared({ ...before, name: data.name ?? before.name }, userId, true);
    }
    return listsService.detail(listId, userId);
  },

  async setArchived(listId: string, userId: string, archived: boolean) {
    const access = await getAccess(listId, userId);
    requireManage(access, userId);
    if (!!access.list.archived_at !== archived) {
      await listsRepository.setArchived(listId, archived);
      await logActivity(access.list.family_id, userId, archived ? 'list.archived' : 'list.restored', listRef(access.list));
    }
    return listsService.detail(listId, userId);
  },

  /** Borrado definitivo: solo de listas ya archivadas (así siempre hay un paso de vuelta atrás). */
  async remove(listId: string, userId: string): Promise<void> {
    const access = await getAccess(listId, userId);
    requireManage(access, userId);
    if (!access.list.archived_at) throw conflict('LIST_NOT_ARCHIVED');
    await listsRepository.delete(listId);
    await logActivity(access.list.family_id, userId, 'list.deleted', listRef(access.list));
  },

  async setPinned(listId: string, userId: string, pinned: boolean) {
    const access = await getAccess(listId, userId);
    await listsRepository.setPinned(listId, userId, pinned);
    return { ...toListView({ ...access.list, pinned }, access) };
  },

  /** Nueva lista del usuario con los mismos ítems sin marcar. Privada solo si era suya y privada. */
  async duplicate(listId: string, userId: string, data: { id?: string; name: string }) {
    const access = await getAccess(listId, userId);
    if (access.supervision) throw forbidden('LIST_READ_ONLY');
    const source = access.list;
    const id = data.id ?? randomUUID();
    await withTransaction(async (conn) => {
      const created = await listsRepository.create(
        {
          id,
          familyId: source.family_id,
          userId,
          name: data.name,
          type: source.type,
          color: source.color,
          icon: source.icon,
          isPrivate: source.is_private && source.created_by === userId,
        },
        conn,
      );
      if (!created) return;
      await listsRepository.copyItems(source.id, id, userId, conn);
      const isPrivate = source.is_private && source.created_by === userId;
      await logActivity(
        source.family_id,
        userId,
        'list.duplicated',
        { listId: id, listName: data.name, privateOwnerId: isPrivate ? userId : null, details: { sourceName: source.name } },
        conn,
      );
    });
    return listsService.detail(id, userId);
  },
};
