import { db, type Db } from '../config/database.js';
import type { DbKind, MovementUpdate, NewMovement, StateMovement } from '../lib/import.js';

/** Importar y exportar finanzas: lecturas y escrituras por lotes (miles de filas en pocas consultas). */
export const financeIoRepository = {
  /** Movimientos de todas las cuentas del grupo, también los borrados (sus números no se reutilizan) */
  async familyMovements(familyId: string, conn: Db = db()): Promise<StateMovement[]> {
    const { rows } = await conn.query<StateMovement>(
      `SELECT m.id, m.account_id AS "accountId", m.number, m.kind, m.amount, m.date, m.description,
              m.category_id AS "categoryId", m.transfer_id AS "transferId", m.deleted_at IS NOT NULL AS deleted
         FROM account_movements m JOIN accounts a ON a.id = m.account_id
        WHERE a.family_id = $1`,
      [familyId],
    );
    return rows;
  },

  /** Un solo import a la vez por grupo: los números y prefijos se calculan sin carreras */
  lockFamily: (familyId: string, conn: Db) => conn.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finance-import:${familyId}`]),

  async insertMovements(movements: NewMovement[], userId: string, conn: Db): Promise<void> {
    if (!movements.length) return;
    await conn.query(
      `INSERT INTO account_movements (id, account_id, number, kind, amount, date, description, category_id, created_by, transfer_id)
       SELECT x.id, x.account_id, x.number, x.kind, x.amount, x.date, x.description, x.category_id, $2, x.transfer_id
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, account_id uuid, number int, kind text, amount numeric,
                                                  date date, description text, category_id uuid, transfer_id uuid)`,
      [
        JSON.stringify(
          movements.map((m) => ({
            id: m.id,
            account_id: m.accountId,
            number: m.number,
            kind: m.kind,
            amount: m.amount,
            date: m.date,
            description: m.description,
            category_id: m.categoryId,
            transfer_id: m.transferId,
          })),
        ),
        userId,
      ],
    );
  },

  async updateMovements(updates: MovementUpdate[], userId: string, conn: Db): Promise<void> {
    if (!updates.length) return;
    await conn.query(
      `UPDATE account_movements m
          SET kind = x.kind, amount = x.amount, date = x.date, description = x.description, category_id = x.category_id,
              -- Solo una salida se paga con el ahorro
              savings_project_id = CASE WHEN x.kind = 'out' THEN m.savings_project_id END,
              updated_by = $2, updated_at = now()
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, kind text, amount numeric, date date, description text, category_id uuid)
        WHERE m.id = x.id`,
      [
        JSON.stringify(
          updates.map((u) => ({ id: u.id, kind: u.kind, amount: u.amount, date: u.date, description: u.description, category_id: u.categoryId })),
        ),
        userId,
      ],
    );
  },

  async addHistory(entries: { movementId: string; action: 'created' | 'updated'; changes: object | null }[], userId: string, conn: Db) {
    if (!entries.length) return;
    await conn.query(
      `INSERT INTO account_movement_history (movement_id, actor_id, action, changes)
       SELECT x.movement_id, $2, x.action, x.changes FROM jsonb_to_recordset($1::jsonb) AS x(movement_id uuid, action text, changes jsonb)`,
      [JSON.stringify(entries.map((e) => ({ movement_id: e.movementId, action: e.action, changes: e.changes }))), userId],
    );
  },

  /** last_number nunca baja */
  raiseLastNumber: (accountId: string, n: number, conn: Db) =>
    conn.query('UPDATE accounts SET last_number = GREATEST(last_number, $2) WHERE id = $1', [accountId, n]),

  /** Movimientos vigentes de las cuentas, con la otra mitad de las transferencias, para exportar */
  async exportMovements(accountIds: string[], from: string | null, to: string | null) {
    const { rows } = await db().query<{
      account_id: string;
      number: number;
      kind: DbKind;
      amount: number;
      date: string;
      description: string;
      category_name: string | null;
      other_account_id: string | null;
      other_number: number | null;
    }>(
      `SELECT m.account_id, m.number, m.kind, m.amount, m.date, m.description, c.name AS category_name,
              t.account_id AS other_account_id, t.number AS other_number
         FROM account_movements m
         LEFT JOIN movement_categories c ON c.id = m.category_id
         LEFT JOIN account_movements t ON t.transfer_id = m.transfer_id AND t.id <> m.id
        WHERE m.account_id = ANY($1::uuid[]) AND m.deleted_at IS NULL
          AND ($2::date IS NULL OR m.date >= $2) AND ($3::date IS NULL OR m.date <= $3)
        ORDER BY m.date, m.created_at, m.number`,
      [accountIds, from, to],
    );
    return rows;
  },
};
