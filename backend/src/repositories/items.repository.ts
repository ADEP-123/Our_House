import { db, type Db } from '../config/database.js';
import { ITEM_SELECT, type ItemRow } from './lists.repository.js';

/** Campos que se pueden escribir al crear o editar un ítem, con su columna. */
const COLUMNS = {
  text: 'text',
  description: 'description',
  amount: 'amount',
  unit: 'unit',
  category: 'category',
  assigneeId: 'assignee_id',
  dueDate: 'due_date',
  dueTime: 'due_time',
  dueTz: 'due_tz',
  reminderStartDays: 'reminder_start_days',
  reminderEveryDays: 'reminder_every_days',
  remindersOff: 'reminders_off',
  position: 'position',
  parentId: 'parent_id',
} as const;

export type ItemFields = {
  text?: string;
  description?: string | null;
  amount?: number | null;
  unit?: string | null;
  category?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  /** 'HH:MM' o null */
  dueTime?: string | null;
  /** Zona horaria en que se interpreta la hora (la de quien la pone) */
  dueTz?: string | null;
  /** Recordatorios de esta tarea: null = los del perfil de quien la recibe */
  reminderStartDays?: number | null;
  reminderEveryDays?: number | null;
  remindersOff?: boolean;
  position?: number;
  /** Solo al crear: la tarea de la que es subtarea */
  parentId?: string | null;
};

const present = (f: ItemFields) => (Object.keys(COLUMNS) as (keyof ItemFields)[]).filter((k) => f[k] !== undefined);

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

  /** Tareas pendientes asignadas a la persona en listas que puede ver (no archivadas), de todos sus grupos */
  async assignedTo(userId: string, conn: Db = db()) {
    const { rows } = await conn.query<
      ItemRow & { list_name: string; list_color: string; list_icon: string; family_id: string; family_name: string; parent_text: string | null }
    >(
      `SELECT x.*, l.name AS list_name, l.color AS list_color, l.icon AS list_icon,
              f.id AS family_id, f.name AS family_name, p.text AS parent_text
         FROM (${ITEM_SELECT}) x
         JOIN lists l ON l.id = x.list_id
         JOIN families f ON f.id = l.family_id
         JOIN family_members m ON m.family_id = f.id AND m.user_id = $1
         LEFT JOIN list_items p ON p.id = x.parent_id
        WHERE x.assignee_id = $1 AND x.completed_at IS NULL AND 'assignee' = ANY(l.features) AND l.archived_at IS NULL
          AND (NOT l.is_private OR l.created_by = $1)
        ORDER BY x.due_date NULLS LAST, x.due_time NULLS LAST, x.created_at`,
      [userId],
    );
    return rows;
  },

  // ---------- Subtareas ----------

  /** Completa las subtareas pendientes de una tarea. Devuelve cuántas cambiaron. */
  async completeChildren(parentId: string, userId: string, conn: Db = db()): Promise<number> {
    const { rowCount } = await conn.query(
      `UPDATE list_items SET completed_at = now(), completed_by = $2, updated_at = now()
        WHERE parent_id = $1 AND completed_at IS NULL`,
      [parentId, userId],
    );
    return rowCount ?? 0;
  },

  /**
   * La tarea sigue a sus subtareas: se completa sola cuando todas están hechas
   * y vuelve a pendiente si alguna se desmarca o se agrega una nueva.
   * Devuelve el cambio que hubo en la tarea (para la bitácora).
   */
  async syncParent(parentId: string, userId: string, conn: Db = db()): Promise<'completed' | 'uncompleted' | null> {
    const { rows } = await conn.query<{ result: 'completed' | 'uncompleted' }>(
      `WITH c AS (
         SELECT count(*) AS total, count(*) FILTER (WHERE completed_at IS NULL) AS pending
           FROM list_items WHERE parent_id = $1
       )
       UPDATE list_items p
          SET completed_at = CASE WHEN c.pending = 0 THEN now() ELSE NULL END,
              completed_by = CASE WHEN c.pending = 0 THEN $2::uuid ELSE NULL END,
              updated_at = now()
         FROM c
        WHERE p.id = $1 AND c.total > 0
          AND ((c.pending = 0 AND p.completed_at IS NULL) OR (c.pending > 0 AND p.completed_at IS NOT NULL))
       RETURNING CASE WHEN c.pending = 0 THEN 'completed' ELSE 'uncompleted' END AS result`,
      [parentId, userId],
    );
    return rows[0]?.result ?? null;
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
