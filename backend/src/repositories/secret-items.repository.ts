import { db, type Db } from '../config/database.js';

export interface SecretItemRow {
  id: string;
  list_id: string;
  title: string;
  payload_enc: string;
  position: number;
  created_by: string;
  creator_nickname: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT s.*, u.nickname AS creator_nickname FROM secret_items s LEFT JOIN users u ON u.id = s.created_by`;
const touchList = (listId: string, conn: Db) => conn.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);

export const secretItemsRepository = {
  async forList(listId: string, conn: Db = db()): Promise<SecretItemRow[]> {
    return (await conn.query<SecretItemRow>(`${SELECT} WHERE s.list_id = $1 ORDER BY s.position, s.created_at`, [listId])).rows;
  },

  async find(id: string, conn: Db = db()): Promise<SecretItemRow | null> {
    return (await conn.query<SecretItemRow>(`${SELECT} WHERE s.id = $1`, [id])).rows[0] ?? null;
  },

  /** Con un id repetido (reenvío) no hace nada y devuelve false */
  async create(data: { id: string; listId: string; title: string; payloadEnc: string; userId: string }, conn: Db = db()): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO secret_items (id, list_id, title, payload_enc, position, created_by)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(position), 0) + 1 FROM secret_items WHERE list_id = $2), $5)
       ON CONFLICT (id) DO NOTHING`,
      [data.id, data.listId, data.title, data.payloadEnc, data.userId],
    );
    if (rowCount) await touchList(data.listId, conn);
    return rowCount === 1;
  },

  async update(id: string, listId: string, data: { title?: string; payloadEnc?: string }, conn: Db = db()): Promise<void> {
    await conn.query(
      `UPDATE secret_items SET title = COALESCE($2, title), payload_enc = COALESCE($3, payload_enc), updated_at = now() WHERE id = $1`,
      [id, data.title ?? null, data.payloadEnc ?? null],
    );
    await touchList(listId, conn);
  },

  /** Borrado definitivo: la fila y su contenido cifrado desaparecen de la base de datos */
  async delete(id: string, listId: string, conn: Db = db()): Promise<void> {
    await conn.query('DELETE FROM secret_items WHERE id = $1', [id]);
    await touchList(listId, conn);
  },

  /** Quiénes (además de una persona) tienen elementos en la lista */
  async creatorsOtherThan(listId: string, userId: string, conn: Db = db()): Promise<string[]> {
    const { rows } = await conn.query<{ created_by: string }>(
      'SELECT DISTINCT created_by FROM secret_items WHERE list_id = $1 AND created_by <> $2',
      [listId, userId],
    );
    return rows.map((r) => r.created_by);
  },
};
