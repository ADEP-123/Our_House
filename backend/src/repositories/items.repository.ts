import { db, type Db } from '../config/database.js';
import type { ItemRow } from './lists.repository.js';

export interface ItemFields {
  text?: string;
  note?: string | null;
  quantity?: string | null;
  category?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  position?: number;
}

const ITEM_SELECT = `SELECT i.*, u.nickname AS completed_by_nickname
                       FROM list_items i LEFT JOIN users u ON u.id = i.completed_by`;

/** Cualquier cambio en los ítems cuenta como actividad de la lista (orden de las tarjetas). */
const touchList = (listId: string, conn: Db) => conn.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);

export const itemsRepository = {
  async find(itemId: string, conn: Db = db()): Promise<ItemRow | null> {
    return (await conn.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [itemId])).rows[0] ?? null;
  },

  /** Crea el ítem (al final si no trae posición). Con un id repetido no hace nada y devuelve false. */
  async create(listId: string, id: string, userId: string, f: ItemFields & { text: string }, conn: Db = db()): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO list_items (id, list_id, text, note, quantity, category, assignee_id, due_date, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               COALESCE($9, (SELECT COALESCE(max(position), 0) + 1 FROM list_items WHERE list_id = $2)), $10)
       ON CONFLICT (id) DO NOTHING`,
      [id, listId, f.text, f.note ?? null, f.quantity ?? null, f.category ?? null, f.assigneeId ?? null, f.dueDate ?? null, f.position ?? null, userId],
    );
    if (rowCount) await touchList(listId, conn);
    return rowCount === 1;
  },

  /** Solo cambia los campos presentes; null borra el dato opcional. */
  async update(itemId: string, listId: string, f: ItemFields, conn: Db = db()): Promise<void> {
    const columns: Record<keyof ItemFields, string> = {
      text: 'text',
      note: 'note',
      quantity: 'quantity',
      category: 'category',
      assigneeId: 'assignee_id',
      dueDate: 'due_date',
      position: 'position',
    };
    const entries = (Object.keys(columns) as (keyof ItemFields)[]).filter((k) => f[k] !== undefined);
    if (!entries.length) return;
    const sets = entries.map((k, i) => `${columns[k]} = $${i + 2}`);
    await conn.query(`UPDATE list_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [
      itemId,
      ...entries.map((k) => f[k]),
    ]);
    await touchList(listId, conn);
  },

  /** Marcar es idempotente: si ya estaba hecho conserva quién y cuándo lo marcó. */
  async setCompleted(itemId: string, listId: string, completed: boolean, userId: string, conn: Db = db()): Promise<void> {
    if (completed) {
      await conn.query(
        `UPDATE list_items
            SET completed_by = CASE WHEN completed_at IS NULL THEN $2 ELSE completed_by END,
                completed_at = COALESCE(completed_at, now()),
                updated_at = now()
          WHERE id = $1`,
        [itemId, userId],
      );
    } else {
      await conn.query('UPDATE list_items SET completed_at = NULL, completed_by = NULL, updated_at = now() WHERE id = $1', [itemId]);
    }
    await touchList(listId, conn);
  },

  async delete(itemId: string, listId: string, conn: Db = db()): Promise<void> {
    await conn.query('DELETE FROM list_items WHERE id = $1', [itemId]);
    await touchList(listId, conn);
  },

  /** Desmarca todo. Devuelve cuántos se desmarcaron. */
  async uncheckAll(listId: string, conn: Db = db()): Promise<number> {
    const { rowCount } = await conn.query(
      'UPDATE list_items SET completed_at = NULL, completed_by = NULL, updated_at = now() WHERE list_id = $1 AND completed_at IS NOT NULL',
      [listId],
    );
    await touchList(listId, conn);
    return rowCount ?? 0;
  },

  /** Borra los completados. Devuelve cuántos se borraron. */
  async deleteCompleted(listId: string, conn: Db = db()): Promise<number> {
    const { rowCount } = await conn.query('DELETE FROM list_items WHERE list_id = $1 AND completed_at IS NOT NULL', [listId]);
    await touchList(listId, conn);
    return rowCount ?? 0;
  },
};
