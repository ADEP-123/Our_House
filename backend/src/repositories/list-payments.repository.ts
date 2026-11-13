import { db, type Db } from '../config/database.js';

export interface PendingItemRow {
  id: string;
  text: string;
  /** Lo pagado que todavía no entra en un pago */
  amount: number;
}

export interface PaymentRow {
  id: string;
  list_id: string;
  movement_id: string | null;
  account_id: string | null;
  amount: number;
  items_count: number;
  registered: boolean;
  created_by: string | null;
  created_by_nickname: string | null;
  created_at: Date;
  account_name: string | null;
  account_prefix: string | null;
  movement_number: number | null;
  movement_deleted: boolean | null;
}

/** Pago con un artículo dentro, para descontarlo al desmarcar */
export interface PaidLinkRow {
  payment_id: string;
  item_id: string;
  amount: number;
  movement_id: string | null;
  account_id: string | null;
  movement_amount: number | null;
  movement_deleted: boolean | null;
}

/** Lo pagado de cada artículo menos lo que ya entró en pagos anteriores */
export const PENDING_AMOUNT = `round(COALESCE(i.spent, 0) + COALESCE(i.unpaid, 0)
  - COALESCE((SELECT sum(x.amount) FROM list_payment_items x WHERE x.item_id = i.id), 0), 2)`;

const PENDING = `
  SELECT * FROM (
    SELECT i.id, i.text, ${PENDING_AMOUNT} AS amount, i.position, i.created_at
      FROM list_items i
     WHERE i.list_id = $1 AND (i.spent IS NOT NULL OR i.unpaid IS NOT NULL)
  ) p WHERE p.amount > 0
   ORDER BY p.position, p.created_at`;

export const listPaymentsRepository = {
  async pendingItems(listId: string, conn: Db = db()): Promise<PendingItemRow[]> {
    return (await conn.query<PendingItemRow>(PENDING, [listId])).rows;
  },

  /** Bloquea la lista mientras se registra un pago (dos personas a la vez no pagan lo mismo dos veces) */
  lockList: (listId: string, conn: Db) => conn.query('SELECT id FROM lists WHERE id = $1 FOR UPDATE', [listId]),

  async recent(listId: string, limit = 5): Promise<PaymentRow[]> {
    const { rows } = await db().query<PaymentRow>(
      `SELECT p.*, u.nickname AS created_by_nickname, a.name AS account_name, a.prefix AS account_prefix,
              m.number AS movement_number, m.deleted_at IS NOT NULL AS movement_deleted
         FROM list_payments p
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN accounts a ON a.id = p.account_id
         LEFT JOIN account_movements m ON m.id = p.movement_id
        WHERE p.list_id = $1
        ORDER BY p.created_at DESC LIMIT $2`,
      [listId, limit],
    );
    return rows;
  },

  async find(id: string, conn: Db = db()): Promise<{ id: string; list_id: string } | null> {
    return (await conn.query<{ id: string; list_id: string }>('SELECT id, list_id FROM list_payments WHERE id = $1', [id])).rows[0] ?? null;
  },

  async create(
    p: { id: string; listId: string; movementId: string | null; accountId: string | null; amount: number; registered: boolean; userId: string },
    items: PendingItemRow[],
    conn: Db,
  ): Promise<void> {
    await conn.query(
      `INSERT INTO list_payments (id, list_id, movement_id, account_id, amount, items_count, registered, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.id, p.listId, p.movementId, p.accountId, p.amount, items.length, p.registered, p.userId],
    );
    await conn.query(
      `INSERT INTO list_payment_items (payment_id, item_id, amount)
       SELECT $1, x.item_id, x.amount FROM jsonb_to_recordset($2::jsonb) AS x(item_id uuid, amount numeric)`,
      [p.id, JSON.stringify(items.map((i) => ({ item_id: i.id, amount: i.amount })))],
    );
  },

  /** Lo que la lista recuerda para el próximo pago */
  remember: (listId: string, accountId: string | null, categoryId: string | null, conn: Db) =>
    conn.query(
      `UPDATE lists SET payment_account_id = COALESCE($2, payment_account_id), payment_category_id = COALESCE($3, payment_category_id) WHERE id = $1`,
      [listId, accountId, categoryId],
    ),

  async settings(listId: string): Promise<{ payment_account_id: string | null; payment_category_id: string | null }> {
    const { rows } = await db().query<{ payment_account_id: string | null; payment_category_id: string | null }>(
      'SELECT payment_account_id, payment_category_id FROM lists WHERE id = $1',
      [listId],
    );
    return rows[0] ?? { payment_account_id: null, payment_category_id: null };
  },

  /** Pagos donde entraron estos artículos (null = todos los de la lista), con su movimiento */
  async links(listId: string, itemIds: string[] | null, conn: Db = db()): Promise<PaidLinkRow[]> {
    const { rows } = await conn.query<PaidLinkRow>(
      `SELECT x.payment_id, x.item_id, x.amount, p.movement_id, p.account_id,
              m.amount AS movement_amount, m.deleted_at IS NOT NULL AS movement_deleted
         FROM list_payment_items x
         JOIN list_payments p ON p.id = x.payment_id
         LEFT JOIN account_movements m ON m.id = p.movement_id
        WHERE p.list_id = $1 AND ($2::uuid[] IS NULL OR x.item_id = ANY($2::uuid[]))`,
      [listId, itemIds],
    );
    return rows;
  },

  /** Saca artículos de un pago: baja su monto y su cantidad */
  removeItems: (paymentId: string, itemIds: string[], amount: number, conn: Db) =>
    Promise.all([
      conn.query('DELETE FROM list_payment_items WHERE payment_id = $1 AND item_id = ANY($2::uuid[])', [paymentId, itemIds]),
      conn.query('UPDATE list_payments SET amount = GREATEST(0, amount - $2), items_count = GREATEST(0, items_count - $3) WHERE id = $1', [
        paymentId,
        amount,
        itemIds.length,
      ]),
    ]),

};
