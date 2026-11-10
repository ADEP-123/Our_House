import { db, type Db } from '../config/database.js';

export interface ActivityInput {
  familyId: string;
  /** null = acción automática del sistema (ej. purga de archivadas) */
  actorId: string | null;
  action: string;
  listId?: string | null;
  listName?: string | null;
  itemId?: string | null;
  itemText?: string | null;
  privateOwnerId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ActivityRow {
  id: string;
  family_id: string;
  actor_id: string | null;
  actor_nickname: string | null;
  action: string;
  list_id: string | null;
  list_name: string | null;
  item_id: string | null;
  item_text: string | null;
  private_owner_id: string | null;
  owner_role: string | null;
  owner_nickname: string | null;
  details: Record<string, unknown> | null;
  created_at: Date;
}

export interface ActivityFilters {
  listId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  /** Cursor: trae registros anteriores a este id */
  before?: string;
  limit: number;
}

export const activityRepository = {
  /**
   * Lo que el grupo suele agregar en listas de un tipo (para sugerirlo al crear otra):
   * los textos más usados y recientes, solo de listas compartidas y sin subtareas.
   */
  async usualItems(familyId: string, type: string, limit = 24, conn: Db = db()): Promise<string[]> {
    const { rows } = await conn.query<{ text: string }>(
      `SELECT (array_agg(trim(a.item_text) ORDER BY a.created_at DESC))[1] AS text
         FROM activity_log a
         JOIN lists l ON l.id = a.list_id
        WHERE a.family_id = $1 AND a.action = 'item.created' AND a.private_owner_id IS NULL
          AND l.type = $2 AND NOT l.is_private AND a.item_text IS NOT NULL AND a.details ? 'subtaskOf' IS NOT TRUE
        GROUP BY lower(trim(a.item_text))
        ORDER BY count(*) DESC, max(a.created_at) DESC
        LIMIT $3`,
      [familyId, type, limit],
    );
    return rows.map((r) => r.text);
  },

  add: (e: ActivityInput, conn: Db = db()) =>
    conn.query(
      `INSERT INTO activity_log
         (family_id, actor_id, actor_nickname, action, list_id, list_name, item_id, item_text, private_owner_id, details)
       VALUES ($1, $2, (SELECT nickname FROM users WHERE id = $2), $3, $4, $5, $6, $7, $8, $9)`,
      [
        e.familyId,
        e.actorId,
        e.action,
        e.listId ?? null,
        e.listName ?? null,
        e.itemId ?? null,
        e.itemText ?? null,
        e.privateOwnerId ?? null,
        e.details ? JSON.stringify(e.details) : null,
      ],
    ),

  /** ¿Ya se registró esta acción hace poco? (evita repetir "consultó" con la actualización cada 15 s) */
  async recentExists(familyId: string, actorId: string, action: string, listId: string, minutes: number): Promise<boolean> {
    const { rowCount } = await db().query(
      `SELECT 1 FROM activity_log
        WHERE family_id = $1 AND actor_id = $2 AND action = $3 AND list_id = $4
          AND created_at > now() - make_interval(mins => $5)
        LIMIT 1`,
      [familyId, actorId, action, listId, minutes],
    );
    return !!rowCount;
  },

  async list(familyId: string, f: ActivityFilters): Promise<ActivityRow[]> {
    const where = ['a.family_id = $1'];
    const params: unknown[] = [familyId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (f.listId) add('a.list_id = ?', f.listId);
    if (f.actorId) add('a.actor_id = ?', f.actorId);
    if (f.from) add('a.created_at >= ?::date', f.from);
    if (f.to) add("a.created_at < ?::date + interval '1 day'", f.to);
    if (f.before) add('a.id < ?', f.before);
    params.push(f.limit);
    const { rows } = await db().query<ActivityRow>(
      `SELECT a.*, fm.role AS owner_role, u.nickname AS owner_nickname
         FROM activity_log a
         LEFT JOIN family_members fm ON fm.family_id = a.family_id AND fm.user_id = a.private_owner_id
         LEFT JOIN users u ON u.id = a.private_owner_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  },

  /** Opciones para los filtros: listas y personas que aparecen en la bitácora */
  async filters(familyId: string) {
    const lists = await db().query<{ list_id: string; list_name: string; private_owner_id: string | null; owner_role: string | null }>(
      `SELECT DISTINCT ON (a.list_id) a.list_id, a.list_name, a.private_owner_id, fm.role AS owner_role
         FROM activity_log a
         LEFT JOIN family_members fm ON fm.family_id = a.family_id AND fm.user_id = a.private_owner_id
        WHERE a.family_id = $1 AND a.list_id IS NOT NULL
        ORDER BY a.list_id, a.id DESC`,
      [familyId],
    );
    const actors = await db().query<{ actor_id: string; actor_nickname: string }>(
      `SELECT DISTINCT ON (actor_id) actor_id, actor_nickname
         FROM activity_log WHERE family_id = $1 AND actor_id IS NOT NULL
        ORDER BY actor_id, id DESC`,
      [familyId],
    );
    return { lists: lists.rows, actors: actors.rows };
  },
};
