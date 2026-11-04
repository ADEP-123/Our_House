import type { Db } from '../config/database.js';
import { activityRepository, type ActivityFilters, type ActivityRow } from '../repositories/activity.repository.js';
import type { ListCardRow } from '../repositories/lists.repository.js';
import { requireLeader } from './families.service.js';

/** Datos de la lista que se copian en cada registro */
export const listRef = (list: Pick<ListCardRow, 'id' | 'name' | 'is_private' | 'created_by'>) => ({
  listId: list.id,
  listName: list.name,
  privateOwnerId: list.is_private ? list.created_by : null,
});

export function logActivity(
  familyId: string,
  actorId: string | null,
  action: string,
  data: Omit<Parameters<typeof activityRepository.add>[0], 'familyId' | 'actorId' | 'action'> = {},
  conn?: Db,
) {
  return activityRepository.add({ familyId, actorId, action, ...data }, conn);
}

/**
 * Un registro de lista privada solo se muestra completo a su dueño,
 * o a los líderes si el dueño es miembro supervisado. Para el resto se oculta nombre y contenido.
 */
function isHidden(row: ActivityRow, viewerId: string): boolean {
  return !!row.private_owner_id && row.private_owner_id !== viewerId && row.owner_role !== 'supervised';
}

function toView(row: ActivityRow, viewerId: string) {
  const hidden = isHidden(row, viewerId);
  return {
    id: row.id,
    action: row.action,
    actor: row.actor_id || row.actor_nickname ? { id: row.actor_id, nickname: row.actor_nickname } : null,
    list: row.list_id ? { id: row.list_id, name: hidden ? null : row.list_name, private: !!row.private_owner_id } : null,
    item: row.item_id ? { id: row.item_id, text: hidden ? null : row.item_text } : null,
    owner: row.private_owner_id ? { nickname: row.owner_nickname } : null,
    details: hidden ? null : row.details,
    hidden,
    createdAt: row.created_at,
  };
}

export const activityService = {
  async list(familyId: string, viewerId: string, filters: ActivityFilters) {
    await requireLeader(familyId, viewerId);
    const rows = await activityRepository.list(familyId, { ...filters, limit: filters.limit + 1 });
    const page = rows.slice(0, filters.limit);
    return {
      entries: page.map((r) => toView(r, viewerId)),
      nextCursor: rows.length > filters.limit ? page.at(-1)!.id : null,
    };
  },

  async filters(familyId: string, viewerId: string) {
    await requireLeader(familyId, viewerId);
    const { lists, actors } = await activityRepository.filters(familyId);
    return {
      lists: lists.map((l) => {
        const hidden = !!l.private_owner_id && l.private_owner_id !== viewerId && l.owner_role !== 'supervised';
        return { id: l.list_id, name: hidden ? null : l.list_name };
      }),
      actors: actors.map((a) => ({ id: a.actor_id, nickname: a.actor_nickname })),
    };
  },
};
