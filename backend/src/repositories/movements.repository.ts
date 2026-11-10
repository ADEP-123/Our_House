import { db, type Db } from '../config/database.js';

export type MovementKind = 'opening' | 'in' | 'out' | 'adjust' | 'transfer_in' | 'transfer_out';

export interface MovementRow {
  id: string;
  account_id: string;
  number: number;
  kind: MovementKind;
  amount: number;
  date: string;
  description: string;
  category_id: string | null;
  /** Enlaza la salida y la entrada de una transferencia */
  transfer_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Movimiento con su categoría, quién lo creó y el saldo de la cuenta hasta ese movimiento */
export interface MovementViewRow extends MovementRow {
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  created_by_nickname: string | null;
  edited: boolean;
  balance: number;
  /** La otra mitad de una transferencia */
  counterpart_account_id: string | null;
  counterpart_account_name: string | null;
  counterpart_prefix: string | null;
  counterpart_number: number | null;
}

export interface HistoryRow {
  id: string;
  action: 'created' | 'updated' | 'deleted' | 'restored';
  changes: Record<string, [unknown, unknown]> | null;
  actor_id: string | null;
  actor_nickname: string | null;
  created_at: Date;
}

/** Monto con signo: las salidas restan; saldo inicial y ajustes ya traen su signo */
const SIGNED = "CASE WHEN m.kind IN ('out', 'transfer_out') THEN -m.amount ELSE m.amount END";

export const movementsRepository = {
  /**
   * Movimientos vigentes de la cuenta, del más antiguo al más reciente,
   * con el saldo acumulado (por fecha y luego por orden de creación).
   */
  async listForAccount(accountId: string): Promise<MovementViewRow[]> {
    const { rows } = await db().query<MovementViewRow>(
      `SELECT m.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              u.nickname AS created_by_nickname,
              t.account_id AS counterpart_account_id, ta.name AS counterpart_account_name,
              ta.prefix AS counterpart_prefix, t.number AS counterpart_number,
              EXISTS (SELECT 1 FROM account_movement_history h WHERE h.movement_id = m.id AND h.action = 'updated') AS edited,
              sum(${SIGNED}) OVER (ORDER BY m.date, m.created_at, m.number ROWS UNBOUNDED PRECEDING) AS balance
         FROM account_movements m
         LEFT JOIN movement_categories c ON c.id = m.category_id
         LEFT JOIN users u ON u.id = m.created_by
         LEFT JOIN account_movements t ON t.transfer_id = m.transfer_id AND t.id <> m.id
         LEFT JOIN accounts ta ON ta.id = t.account_id
        WHERE m.account_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.date, m.created_at, m.number`,
      [accountId],
    );
    return rows;
  },

  async find(id: string, conn: Db = db()): Promise<MovementRow | null> {
    return (await conn.query<MovementRow>('SELECT * FROM account_movements WHERE id = $1', [id])).rows[0] ?? null;
  },

  /** Crea el movimiento; si el id ya existe (reenvío) no hace nada y devuelve false. */
  async create(
    m: {
      id: string;
      accountId: string;
      number: number;
      kind: MovementKind;
      amount: number;
      date: string;
      description: string;
      categoryId: string | null;
      userId: string;
      transferId?: string | null;
    },
    conn: Db,
  ): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO account_movements (id, account_id, number, kind, amount, date, description, category_id, created_by, transfer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [m.id, m.accountId, m.number, m.kind, m.amount, m.date, m.description, m.categoryId, m.userId, m.transferId ?? null],
    );
    return !!rowCount;
  },

  async update(
    id: string,
    f: { kind: MovementKind; amount: number; date: string; description: string; categoryId: string | null },
    userId: string,
    conn: Db,
  ): Promise<void> {
    await conn.query(
      `UPDATE account_movements SET kind = $2, amount = $3, date = $4, description = $5, category_id = $6,
              updated_by = $7, updated_at = now()
        WHERE id = $1`,
      [id, f.kind, f.amount, f.date, f.description, f.categoryId, userId],
    );
  },

  /** Las dos mitades de una transferencia (salida primero) */
  async transferPair(transferId: string, conn: Db = db()): Promise<MovementRow[]> {
    const { rows } = await conn.query<MovementRow>(
      'SELECT * FROM account_movements WHERE transfer_id = $1 ORDER BY kind DESC',
      [transferId],
    );
    return rows;
  },

  setDeleted: (id: string, deleted: boolean, userId: string, conn: Db) =>
    conn.query(
      'UPDATE account_movements SET deleted_at = CASE WHEN $2 THEN now() END, updated_by = $3, updated_at = now() WHERE id = $1',
      [id, deleted, userId],
    ),

  /** Saldo actual de la cuenta (sin los borrados) */
  async balance(accountId: string, conn: Db = db()): Promise<number> {
    const { rows } = await conn.query<{ balance: number }>(
      `SELECT COALESCE(sum(${SIGNED}), 0) AS balance FROM account_movements m WHERE m.account_id = $1 AND m.deleted_at IS NULL`,
      [accountId],
    );
    return rows[0]!.balance;
  },

  addHistory: (movementId: string, actorId: string | null, action: HistoryRow['action'], changes: object | null, conn: Db) =>
    conn.query('INSERT INTO account_movement_history (movement_id, actor_id, action, changes) VALUES ($1, $2, $3, $4)', [
      movementId,
      actorId,
      action,
      changes ? JSON.stringify(changes) : null,
    ]),

  async history(movementId: string): Promise<HistoryRow[]> {
    const { rows } = await db().query<HistoryRow>(
      `SELECT h.id::text, h.action, h.changes, h.actor_id, u.nickname AS actor_nickname, h.created_at
         FROM account_movement_history h LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.movement_id = $1 ORDER BY h.id`,
      [movementId],
    );
    return rows;
  },

  /**
   * Últimas descripciones que empiezan con el texto, con la categoría que se usó,
   * en las cuentas indicadas (las que la persona ve).
   */
  async suggestions(accountIds: string[], query: string, limit = 6) {
    const { rows } = await db().query<{ description: string; category_id: string | null; kind: MovementKind; created_at: Date }>(
      `SELECT DISTINCT ON (lower(m.description)) m.description, m.category_id, m.kind, m.created_at
         FROM account_movements m
        WHERE m.account_id = ANY($1::uuid[]) AND m.deleted_at IS NULL AND m.kind IN ('in', 'out')
          AND lower(m.description) LIKE lower($2) || '%'
        ORDER BY lower(m.description), m.created_at DESC`,
      [accountIds, query.replace(/[\\%_]/g, (c) => `\\${c}`)],
    );
    // DISTINCT ON obliga a ordenar por descripción: aquí se ordenan de la más reciente a la más antigua
    return rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
  },

  async hiddenColumns(accountId: string, userId: string): Promise<string[]> {
    const { rows } = await db().query<{ hidden_columns: string[] }>(
      'SELECT hidden_columns FROM account_prefs WHERE account_id = $1 AND user_id = $2',
      [accountId, userId],
    );
    return rows[0]?.hidden_columns ?? [];
  },

  setHiddenColumns: (accountId: string, userId: string, columns: string[]) =>
    db().query(
      `INSERT INTO account_prefs (account_id, user_id, hidden_columns) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, user_id) DO UPDATE SET hidden_columns = EXCLUDED.hidden_columns`,
      [accountId, userId, columns],
    ),
};
