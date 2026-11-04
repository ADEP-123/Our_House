import { db, type Db } from '../config/database.js';
import type { FamilyRole } from './families.repository.js';

export interface ListRow {
  id: string;
  family_id: string;
  created_by: string | null;
  name: string;
  type: 'todo' | 'shopping' | 'other';
  color: string;
  icon: string;
  is_private: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Lista con lo necesario para la tarjeta: creador, conteos y si el usuario la fijó. */
export interface ListCardRow extends ListRow {
  creator_nickname: string | null;
  creator_role: FamilyRole | null;
  total: number;
  completed: number;
  /** Suma de lo pagado en los ítems (listas de compras) */
  spent: number | null;
  currency: string;
  pinned: boolean;
}

export interface ItemRow {
  id: string;
  list_id: string;
  text: string;
  note: string | null;
  amount: number | null;
  unit: string | null;
  purchased: number | null;
  spent: number | null;
  last_purchase_id: string | null;
  category: string | null;
  parent_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  completed_at: Date | null;
  completed_by: string | null;
  completed_by_nickname: string | null;
  created_at: Date;
  updated_at: Date;
}

const CARD_SELECT = `
  SELECT l.*, u.nickname AS creator_nickname, fm.role AS creator_role,
         (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id AND i.parent_id IS NULL) AS total,
         (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id AND i.parent_id IS NULL AND i.completed_at IS NOT NULL) AS completed,
         (SELECT sum(i.spent) FROM list_items i WHERE i.list_id = l.id) AS spent,
         f.currency,
         EXISTS (SELECT 1 FROM list_pins p WHERE p.list_id = l.id AND p.user_id = $2) AS pinned
    FROM lists l
    JOIN families f ON f.id = l.family_id
    LEFT JOIN users u ON u.id = l.created_by
    LEFT JOIN family_members fm ON fm.family_id = l.family_id AND fm.user_id = l.created_by`;

export const listsRepository = {
  /** Listas que el usuario puede ver: las del grupo y sus privadas. */
  async listForFamily(familyId: string, userId: string, archived: boolean): Promise<ListCardRow[]> {
    const { rows } = await db().query<ListCardRow>(
      `${CARD_SELECT}
        WHERE l.family_id = $1
          AND (NOT l.is_private OR l.created_by = $2)
          AND (l.archived_at IS NOT NULL) = $3
        ORDER BY pinned DESC, l.updated_at DESC`,
      [familyId, userId, archived],
    );
    return rows;
  },

  /** Listas privadas de los miembros supervisados (solo se muestran a líderes, sin su contenido). */
  async supervisedPrivate(familyId: string, userId: string): Promise<{ id: string; owner_nickname: string }[]> {
    const { rows } = await db().query<{ id: string; owner_nickname: string }>(
      `SELECT l.id, u.nickname AS owner_nickname
         FROM lists l
         JOIN family_members fm ON fm.family_id = l.family_id AND fm.user_id = l.created_by AND fm.role = 'supervised'
         JOIN users u ON u.id = l.created_by
        WHERE l.family_id = $1 AND l.is_private AND l.archived_at IS NULL AND l.created_by <> $2
        ORDER BY u.nickname, l.created_at`,
      [familyId, userId],
    );
    return rows;
  },

  async findCard(listId: string, userId: string, conn: Db = db()): Promise<ListCardRow | null> {
    const { rows } = await conn.query<ListCardRow>(`${CARD_SELECT} WHERE l.id = $1`, [listId, userId]);
    return rows[0] ?? null;
  },

  /** Crea la lista; si el id ya existe (reenvío sin conexión) no hace nada y devuelve false. */
  async create(
    data: { id: string; familyId: string; userId: string; name: string; type: string; color: string; icon: string; isPrivate: boolean },
    conn: Db = db(),
  ): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO lists (id, family_id, created_by, name, type, color, icon, is_private)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [data.id, data.familyId, data.userId, data.name, data.type, data.color, data.icon, data.isPrivate],
    );
    return rowCount === 1;
  },

  update: (id: string, data: { name?: string; color?: string; icon?: string; isPrivate?: boolean }, conn: Db = db()) =>
    conn.query(
      `UPDATE lists SET
         name = COALESCE($2, name), color = COALESCE($3, color), icon = COALESCE($4, icon),
         is_private = COALESCE($5, is_private), updated_at = now()
       WHERE id = $1`,
      [id, data.name ?? null, data.color ?? null, data.icon ?? null, data.isPrivate ?? null],
    ),

  setArchived: (id: string, archived: boolean, conn: Db = db()) =>
    conn.query(`UPDATE lists SET archived_at = ${archived ? 'now()' : 'NULL'}, updated_at = now() WHERE id = $1`, [id]),

  delete: (id: string, conn: Db = db()) => conn.query('DELETE FROM lists WHERE id = $1', [id]),

  /** Borra las archivadas que cumplieron el plazo. Devuelve las borradas (para la bitácora). */
  async purgeArchived(familyId: string, days: number, conn: Db = db()): Promise<{ id: string; name: string; is_private: boolean; created_by: string | null }[]> {
    const { rows } = await conn.query<{ id: string; name: string; is_private: boolean; created_by: string | null }>(
      `DELETE FROM lists
        WHERE family_id = $1 AND archived_at IS NOT NULL AND archived_at < now() - make_interval(days => $2)
        RETURNING id, name, is_private, created_by`,
      [familyId, days],
    );
    return rows;
  },

  setPinned: (listId: string, userId: string, pinned: boolean) =>
    pinned
      ? db().query('INSERT INTO list_pins (list_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [listId, userId])
      : db().query('DELETE FROM list_pins WHERE list_id = $1 AND user_id = $2', [listId, userId]),

  /** Copia los ítems de una lista a otra, todos sin marcar y con ids nuevos (las subtareas siguen a su tarea). */
  copyItems: (fromId: string, toId: string, userId: string, conn: Db) =>
    conn.query(
      `WITH src AS (SELECT *, gen_random_uuid() AS new_id FROM list_items WHERE list_id = $1)
       INSERT INTO list_items (id, list_id, parent_id, text, note, amount, unit, category, assignee_id, due_date, position, created_by)
       SELECT s.new_id, $2, p.new_id, s.text, s.note, s.amount, s.unit, s.category, s.assignee_id, s.due_date, s.position, $3
         FROM src s LEFT JOIN src p ON p.id = s.parent_id`,
      [fromId, toId, userId],
    ),

  /** Las privadas de quien deja el grupo: nadie más podría verlas, se eliminan. */
  deletePrivateOf: (familyId: string, userId: string, conn: Db) =>
    conn.query('DELETE FROM lists WHERE family_id = $1 AND created_by = $2 AND is_private', [familyId, userId]),

  async items(listId: string, conn: Db = db()): Promise<ItemRow[]> {
    const { rows } = await conn.query<ItemRow>(
      `SELECT i.*, u.nickname AS completed_by_nickname
         FROM list_items i LEFT JOIN users u ON u.id = i.completed_by
        WHERE i.list_id = $1
        ORDER BY i.position`,
      [listId],
    );
    return rows;
  },
};
