import { db, type Db } from '../config/database.js';
import type { FamilyRole } from './families.repository.js';

export type AccountKind = 'bank' | 'cash' | 'credit' | 'savings';
export type ViewMode = 'family' | 'members' | 'private';
export type EditMode = 'roles' | 'members';

export interface AccountRow {
  id: string;
  family_id: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  kind: AccountKind;
  prefix: string;
  credit_limit: number | null;
  view_mode: ViewMode;
  edit_mode: EditMode;
  edit_roles: FamilyRole[];
  last_number: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Cuenta con su saldo, el saldo inicial, el dueño y el acceso del usuario que consulta. */
export interface AccountViewRow extends AccountRow {
  owner_nickname: string | null;
  owner_role: FamilyRole | null;
  currency: string;
  balance: number;
  opening_amount: number | null;
  opening_date: string | null;
  opening_number: number | null;
  my_view: boolean;
  my_edit: boolean;
  viewer_ids: string[];
  editor_ids: string[];
}

export interface AccountFields {
  name: string;
  description: string | null;
  kind: AccountKind;
  prefix: string;
  creditLimit: number | null;
  viewMode: ViewMode;
  editMode: EditMode;
  editRoles: FamilyRole[];
}

/** $2 = usuario que consulta */
const VIEW_SELECT = `
  SELECT a.*, u.nickname AS owner_nickname, fm.role AS owner_role, f.currency,
         COALESCE((SELECT sum(CASE WHEN m.kind IN ('opening', 'in') THEN m.amount ELSE -m.amount END)
                     FROM account_movements m WHERE m.account_id = a.id), 0) AS balance,
         o.amount AS opening_amount, o.date AS opening_date, o.number AS opening_number,
         COALESCE(me.can_view, false) AS my_view,
         COALESCE(me.can_edit, false) AS my_edit,
         COALESCE((SELECT array_agg(x.user_id ORDER BY x.user_id) FROM account_access x WHERE x.account_id = a.id AND x.can_view), '{}') AS viewer_ids,
         COALESCE((SELECT array_agg(x.user_id ORDER BY x.user_id) FROM account_access x WHERE x.account_id = a.id AND x.can_edit), '{}') AS editor_ids
    FROM accounts a
    JOIN families f ON f.id = a.family_id
    LEFT JOIN users u ON u.id = a.owner_id
    LEFT JOIN family_members fm ON fm.family_id = a.family_id AND fm.user_id = a.owner_id
    LEFT JOIN account_access me ON me.account_id = a.id AND me.user_id = $2
    LEFT JOIN account_movements o ON o.account_id = a.id AND o.kind = 'opening'`;

export const accountsRepository = {
  /** Todas las cuentas del grupo (activas o archivadas); quién ve cada una lo decide el servicio. */
  async listForFamily(familyId: string, userId: string, archived: boolean): Promise<AccountViewRow[]> {
    const { rows } = await db().query<AccountViewRow>(
      `${VIEW_SELECT} WHERE a.family_id = $1 AND (a.archived_at IS NOT NULL) = $3 ORDER BY a.created_at`,
      [familyId, userId, archived],
    );
    return rows;
  },

  async find(id: string, userId: string, conn: Db = db()): Promise<AccountViewRow | null> {
    const { rows } = await conn.query<AccountViewRow>(`${VIEW_SELECT} WHERE a.id = $1`, [id, userId]);
    return rows[0] ?? null;
  },

  async prefixTaken(familyId: string, prefix: string, exceptId: string | null, conn: Db = db()): Promise<boolean> {
    const { rowCount } = await conn.query(
      'SELECT 1 FROM accounts WHERE family_id = $1 AND prefix = $2 AND id IS DISTINCT FROM $3',
      [familyId, prefix, exceptId],
    );
    return !!rowCount;
  },

  /** Crea la cuenta; si el id ya existe (reenvío) no hace nada y devuelve false. */
  async create(id: string, familyId: string, ownerId: string, f: AccountFields, conn: Db): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO accounts (id, family_id, owner_id, name, description, kind, prefix, credit_limit, view_mode, edit_mode, edit_roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [id, familyId, ownerId, f.name, f.description, f.kind, f.prefix, f.creditLimit, f.viewMode, f.editMode, f.editRoles],
    );
    return !!rowCount;
  },

  async update(id: string, f: AccountFields, conn: Db): Promise<void> {
    await conn.query(
      `UPDATE accounts SET name = $2, description = $3, kind = $4, prefix = $5, credit_limit = $6,
              view_mode = $7, edit_mode = $8, edit_roles = $9, updated_at = now()
        WHERE id = $1`,
      [id, f.name, f.description, f.kind, f.prefix, f.creditLimit, f.viewMode, f.editMode, f.editRoles],
    );
  },

  /** Reemplaza las personas elegidas. */
  async setAccess(accountId: string, entries: { userId: string; canView: boolean; canEdit: boolean }[], conn: Db): Promise<void> {
    await conn.query('DELETE FROM account_access WHERE account_id = $1', [accountId]);
    if (!entries.length) return;
    await conn.query(
      `INSERT INTO account_access (account_id, user_id, can_view, can_edit)
       SELECT $1, * FROM unnest($2::uuid[], $3::boolean[], $4::boolean[])`,
      [accountId, entries.map((e) => e.userId), entries.map((e) => e.canView), entries.map((e) => e.canEdit)],
    );
  },

  /** Siguiente número de movimiento de la cuenta (nunca se reutiliza). */
  async nextNumber(accountId: string, conn: Db): Promise<number> {
    const { rows } = await conn.query<{ last_number: number }>(
      'UPDATE accounts SET last_number = last_number + 1 WHERE id = $1 RETURNING last_number',
      [accountId],
    );
    return rows[0]!.last_number;
  },

  /** Crea o cambia el saldo inicial. */
  async setOpening(accountId: string, amount: number, date: string, userId: string, conn: Db): Promise<void> {
    const { rowCount } = await conn.query(
      "UPDATE account_movements SET amount = $2, date = $3, updated_at = now() WHERE account_id = $1 AND kind = 'opening'",
      [accountId, amount, date],
    );
    if (rowCount) return;
    const number = await accountsRepository.nextNumber(accountId, conn);
    await conn.query(
      `INSERT INTO account_movements (account_id, number, kind, amount, date, description, created_by)
       VALUES ($1, $2, 'opening', $3, $4, 'Saldo inicial', $5)`,
      [accountId, number, amount, date, userId],
    );
  },

  removeOpening: (accountId: string, conn: Db) =>
    conn.query("DELETE FROM account_movements WHERE account_id = $1 AND kind = 'opening'", [accountId]),

  setArchived: (id: string, archived: boolean) =>
    db().query('UPDATE accounts SET archived_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1', [id, archived]),

  delete: (id: string) => db().query('DELETE FROM accounts WHERE id = $1', [id]),

  /**
   * Alguien sale del grupo: sus cuentas privadas se borran (nadie más las podría ver),
   * las demás pasan a los líderes y deja de estar entre las personas elegidas.
   */
  async onMemberLeft(familyId: string, userId: string, conn: Db): Promise<void> {
    await conn.query("DELETE FROM accounts WHERE family_id = $1 AND owner_id = $2 AND view_mode = 'private'", [familyId, userId]);
    await conn.query('UPDATE accounts SET owner_id = NULL, updated_at = now() WHERE family_id = $1 AND owner_id = $2', [familyId, userId]);
    await conn.query(
      'DELETE FROM account_access x USING accounts a WHERE a.id = x.account_id AND a.family_id = $1 AND x.user_id = $2',
      [familyId, userId],
    );
  },
};
