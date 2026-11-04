import { db, type Db } from '../config/database.js';
import type { ItemRow } from './lists.repository.js';

/** Campos que se pueden escribir al crear o editar un ítem, con su columna. */
const COLUMNS = {
  text: 'text',
  note: 'note',
  amount: 'amount',
  unit: 'unit',
  category: 'category',
  assigneeId: 'assignee_id',
  dueDate: 'due_date',
  position: 'position',
} as const;

export type ItemFields = {
  text?: string;
  note?: string | null;
  amount?: number | null;
  unit?: string | null;
  category?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  position?: number;
};

const present = (f: ItemFields) => (Object.keys(COLUMNS) as (keyof ItemFields)[]).filter((k) => f[k] !== undefined);

const ITEM_SELECT = `SELECT i.*, u.nickname AS completed_by_nickname
                       FROM list_items i LEFT JOIN users u ON u.id = i.completed_by`;

/** Cualquier cambio en los ítems cuenta como actividad de la lista (orden de las tarjetas). */
const touchList = (listId: string, conn: Db) => conn.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);

/** Si lo comprado alcanza lo pedido, el ítem queda completo; si no, pendiente (parcial). */
const SYNC_COMPLETION = `
  completed_at = CASE WHEN purchased IS NOT NULL AND (amount IS NULL OR purchased >= amount) THEN COALESCE(completed_at, now()) ELSE NULL END,
  completed_by = CASE WHEN purchased IS NOT NULL AND (amount IS NULL OR purchased >= amount) THEN COALESCE(completed_by, $2::uuid) ELSE NULL END`;

export const itemsRepository = {
  async find(itemId: string, conn: Db = db()): Promise<ItemRow | null> {
    return (await conn.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [itemId])).rows[0] ?? null;
  },

  /** Crea el ítem (al final si no trae posición). Con un id repetido no hace nada y devuelve false. */
  async create(listId: string, id: string, userId: string, f: ItemFields & { text: string }, conn: Db = db()): Promise<boolean> {
    const keys = present(f).filter((k) => k !== 'position');
    const columns = keys.map((k) => COLUMNS[k]);
    const values = keys.map((k) => f[k]);
    const { rowCount } = await conn.query(
      `INSERT INTO list_items (id, list_id, created_by, position${columns.map((c) => `, ${c}`).join('')})
       VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(max(position), 0) + 1 FROM list_items WHERE list_id = $2))${values
         .map((_, i) => `, $${i + 5}`)
         .join('')})
       ON CONFLICT (id) DO NOTHING`,
      [id, listId, userId, f.position ?? null, ...values],
    );
    if (rowCount) await touchList(listId, conn);
    return rowCount === 1;
  },

  /** Solo cambia los campos presentes; null borra el dato opcional. Recalcula si lo comprado ya alcanza. */
  async update(itemId: string, listId: string, userId: string, f: ItemFields, conn: Db = db()): Promise<void> {
    const keys = present(f);
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`);
    await conn.query(`UPDATE list_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [itemId, ...keys.map((k) => f[k])]);
    if (f.amount !== undefined) {
      await conn.query(`UPDATE list_items SET ${SYNC_COMPLETION} WHERE id = $1 AND purchased IS NOT NULL`, [itemId, userId]);
    }
    await touchList(listId, conn);
  },

  /**
   * Marcar es idempotente: si ya estaba hecho conserva quién y cuándo lo marcó.
   * En compras, marcar cuenta como comprado todo; desmarcar borra lo comprado y lo pagado.
   */
  async setCompleted(itemId: string, listId: string, completed: boolean, userId: string, conn: Db = db()): Promise<void> {
    if (completed) {
      await conn.query(
        `UPDATE list_items
            SET completed_by = CASE WHEN completed_at IS NULL THEN $2 ELSE completed_by END,
                completed_at = COALESCE(completed_at, now()),
                purchased = CASE WHEN amount IS NOT NULL THEN GREATEST(COALESCE(purchased, 0), amount) ELSE purchased END,
                updated_at = now()
          WHERE id = $1`,
        [itemId, userId],
      );
    } else {
      await conn.query(
        `UPDATE list_items
            SET completed_at = NULL, completed_by = NULL, purchased = NULL, spent = NULL, last_purchase_id = NULL, updated_at = now()
          WHERE id = $1`,
        [itemId],
      );
    }
    await touchList(listId, conn);
  },

  /**
   * Suma una compra. amount null = lo que faltaba (o el ítem entero si no tiene cantidad).
   * Devuelve false si esa compra ya estaba registrada (reenvío).
   */
  async addPurchase(
    itemId: string,
    listId: string,
    userId: string,
    purchase: { id: string; amount: number | null; spent: number | null },
    conn: Db = db(),
  ): Promise<boolean> {
    const { rowCount } = await conn.query(
      `UPDATE list_items
          SET purchased = CASE
                WHEN amount IS NULL THEN 1
                ELSE COALESCE(purchased, 0) + COALESCE($2::numeric, GREATEST(amount - COALESCE(purchased, 0), 0))
              END,
              spent = CASE WHEN $3::numeric IS NULL THEN spent ELSE COALESCE(spent, 0) + $3::numeric END,
              last_purchase_id = $4::uuid,
              updated_at = now()
        WHERE id = $1 AND last_purchase_id IS DISTINCT FROM $4::uuid`,
      [itemId, purchase.amount, purchase.spent, purchase.id],
    );
    if (!rowCount) return false;
    await conn.query(`UPDATE list_items SET ${SYNC_COMPLETION} WHERE id = $1`, [itemId, userId]);
    await touchList(listId, conn);
    return true;
  },

  async delete(itemId: string, listId: string, conn: Db = db()): Promise<void> {
    await conn.query('DELETE FROM list_items WHERE id = $1', [itemId]);
    await touchList(listId, conn);
  },

  /** Desmarca todo (y borra lo comprado). Devuelve cuántos cambiaron. */
  async uncheckAll(listId: string, conn: Db = db()): Promise<number> {
    const { rowCount } = await conn.query(
      `UPDATE list_items
          SET completed_at = NULL, completed_by = NULL, purchased = NULL, spent = NULL, last_purchase_id = NULL, updated_at = now()
        WHERE list_id = $1 AND (completed_at IS NOT NULL OR purchased IS NOT NULL)`,
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
