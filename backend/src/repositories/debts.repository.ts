import { db, type Db } from '../config/database.js';
import type { DebtEntryKind } from '../lib/debts.js';
import type { FamilyRole } from './families.repository.js';

export type DebtDirection = 'owe' | 'owed';
export type DebtViewMode = 'family' | 'members' | 'private';

export interface DebtRow {
  id: string;
  family_id: string;
  owner_id: string | null;
  owner_nickname: string | null;
  owner_role: FamilyRole | null;
  direction: DebtDirection;
  title: string;
  description: string | null;
  counterparty: string;
  amount: number;
  due_date: string | null;
  installments: number | null;
  interest_rate: number | null;
  interest_period: 'monthly' | 'annual' | null;
  view_mode: DebtViewMode;
  viewer_ids: string[];
  created_at: Date;
}

export interface DebtFields {
  direction: DebtDirection;
  title: string;
  description: string | null;
  counterparty: string;
  amount: number;
  dueDate: string | null;
  installments: number | null;
  interestRate: number | null;
  interestPeriod: 'monthly' | 'annual' | null;
  viewMode: DebtViewMode;
}

export interface DebtEntryRow {
  id: string;
  debt_id: string;
  kind: DebtEntryKind;
  amount: number;
  date: string;
  note: string | null;
  movement_id: string | null;
  created_by: string | null;
  created_by_nickname: string | null;
  created_at: Date;
  account_id: string | null;
  account_name: string | null;
  account_prefix: string | null;
  movement_number: number | null;
  movement_deleted: boolean | null;
}

const SELECT = `
  SELECT d.id, d.family_id, d.owner_id, u.nickname AS owner_nickname, fm.role AS owner_role, d.direction, d.title, d.description,
         d.counterparty, d.amount::float8 AS amount, to_char(d.due_date, 'YYYY-MM-DD') AS due_date, d.installments,
         d.interest_rate::float8 AS interest_rate, d.interest_period, d.view_mode, d.created_at,
         COALESCE((SELECT array_agg(v.user_id ORDER BY v.user_id) FROM debt_viewers v WHERE v.debt_id = d.id), '{}') AS viewer_ids
    FROM debts d
    LEFT JOIN users u ON u.id = d.owner_id
    LEFT JOIN family_members fm ON fm.family_id = d.family_id AND fm.user_id = d.owner_id`;

const ENTRY_SELECT = `
  SELECT e.id, e.debt_id, e.kind, e.amount::float8 AS amount, to_char(e.date, 'YYYY-MM-DD') AS date, e.note, e.movement_id,
         e.created_by, u.nickname AS created_by_nickname, e.created_at,
         m.account_id, a.name AS account_name, a.prefix AS account_prefix, m.number AS movement_number,
         (m.deleted_at IS NOT NULL) AS movement_deleted
    FROM debt_entries e
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN account_movements m ON m.id = e.movement_id
    LEFT JOIN accounts a ON a.id = m.account_id`;

export const debtsRepository = {
  async listForFamily(familyId: string): Promise<DebtRow[]> {
    return (await db().query<DebtRow>(`${SELECT} WHERE d.family_id = $1 ORDER BY d.created_at`, [familyId])).rows;
  },

  async find(id: string, conn: Db = db()): Promise<DebtRow | null> {
    return (await conn.query<DebtRow>(`${SELECT} WHERE d.id = $1`, [id])).rows[0] ?? null;
  },

  /** Si el id ya existe (reenvío) no hace nada y devuelve false */
  async create(id: string, familyId: string, ownerId: string, f: DebtFields, conn: Db): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO debts (id, family_id, owner_id, direction, title, description, counterparty, amount, due_date, installments,
                          interest_rate, interest_period, view_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO NOTHING`,
      [id, familyId, ownerId, f.direction, f.title, f.description, f.counterparty, f.amount, f.dueDate, f.installments, f.interestRate, f.interestPeriod, f.viewMode],
    );
    return !!rowCount;
  },

  async update(id: string, f: DebtFields, conn: Db): Promise<void> {
    await conn.query(
      `UPDATE debts SET direction = $2, title = $3, description = $4, counterparty = $5, amount = $6, due_date = $7, installments = $8,
              interest_rate = $9, interest_period = $10, view_mode = $11, updated_at = now()
        WHERE id = $1`,
      [id, f.direction, f.title, f.description, f.counterparty, f.amount, f.dueDate, f.installments, f.interestRate, f.interestPeriod, f.viewMode],
    );
  },

  async setViewers(id: string, userIds: string[], conn: Db): Promise<void> {
    await conn.query('DELETE FROM debt_viewers WHERE debt_id = $1', [id]);
    if (userIds.length) await conn.query('INSERT INTO debt_viewers (debt_id, user_id) SELECT $1, unnest($2::uuid[])', [id, userIds]);
  },

  async delete(id: string): Promise<void> {
    await db().query('DELETE FROM debts WHERE id = $1', [id]);
  },

  async entries(debtIds: string[]): Promise<DebtEntryRow[]> {
    if (!debtIds.length) return [];
    return (await db().query<DebtEntryRow>(`${ENTRY_SELECT} WHERE e.debt_id = ANY($1::uuid[]) ORDER BY e.date, e.created_at`, [debtIds])).rows;
  },

  async findEntry(id: string): Promise<DebtEntryRow | null> {
    return (await db().query<DebtEntryRow>(`${ENTRY_SELECT} WHERE e.id = $1`, [id])).rows[0] ?? null;
  },

  async addEntry(
    e: { id: string; debtId: string; kind: DebtEntryKind; amount: number; date: string; note: string | null; movementId: string | null; userId: string },
    conn: Db = db(),
  ): Promise<void> {
    await conn.query(
      `INSERT INTO debt_entries (id, debt_id, kind, amount, date, note, movement_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.debtId, e.kind, e.amount, e.date, e.note, e.movementId, e.userId],
    );
  },

  async deleteEntry(id: string): Promise<void> {
    await db().query('DELETE FROM debt_entries WHERE id = $1', [id]);
  },
};
