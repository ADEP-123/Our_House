import { db, type Db } from '../config/database.js';

export type FamilyRole = 'leader' | 'member';

export interface FamilyRow {
  id: string;
  name: string;
  avatar_url: string | null;
  avatar_preset: string | null;
  invite_code: string;
  created_at: Date;
}

export interface FamilySummaryRow extends FamilyRow {
  role: FamilyRole;
  member_count: number;
}

export interface MemberRow {
  user_id: string;
  role: FamilyRole;
  joined_at: Date;
  nickname: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_preset: string | null;
}

export const familiesRepository = {
  async create(name: string, inviteCode: string, userId: string, conn: Db): Promise<FamilyRow> {
    const { rows } = await conn.query<FamilyRow>(
      'INSERT INTO families (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, inviteCode, userId],
    );
    return rows[0]!;
  },

  async findById(id: string, conn: Db = db()): Promise<FamilyRow | null> {
    return (await conn.query<FamilyRow>('SELECT * FROM families WHERE id = $1', [id])).rows[0] ?? null;
  },

  async findByInviteCode(code: string): Promise<FamilyRow | null> {
    return (await db().query<FamilyRow>('SELECT * FROM families WHERE invite_code = $1', [code])).rows[0] ?? null;
  },

  /** Grupos del usuario con su rol y cuántos miembros tienen. */
  async listForUser(userId: string): Promise<FamilySummaryRow[]> {
    const { rows } = await db().query<FamilySummaryRow>(
      `SELECT f.*, m.role,
              (SELECT count(*)::int FROM family_members x WHERE x.family_id = f.id) AS member_count
         FROM family_members m JOIN families f ON f.id = m.family_id
        WHERE m.user_id = $1
        ORDER BY m.joined_at`,
      [userId],
    );
    return rows;
  },

  async update(id: string, data: { name?: string; avatarUrl?: string | null; avatarPreset?: string | null; inviteCode?: string }) {
    const { rows } = await db().query<FamilyRow>(
      `UPDATE families SET
         name = COALESCE($2, name),
         avatar_url = CASE WHEN $3 THEN $4 ELSE avatar_url END,
         avatar_preset = CASE WHEN $3 THEN $5 ELSE avatar_preset END,
         invite_code = COALESCE($6, invite_code),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, data.name ?? null, 'avatarUrl' in data || 'avatarPreset' in data, data.avatarUrl ?? null, data.avatarPreset ?? null, data.inviteCode ?? null],
    );
    return rows[0]!;
  },

  delete: (id: string, conn: Db) => conn.query('DELETE FROM families WHERE id = $1', [id]),

  // ---------- Miembros ----------

  async getRole(familyId: string, userId: string, conn: Db = db()): Promise<FamilyRole | null> {
    const { rows } = await conn.query<{ role: FamilyRole }>(
      'SELECT role FROM family_members WHERE family_id = $1 AND user_id = $2',
      [familyId, userId],
    );
    return rows[0]?.role ?? null;
  },

  async listMembers(familyId: string): Promise<MemberRow[]> {
    const { rows } = await db().query<MemberRow>(
      `SELECT m.user_id, m.role, m.joined_at, u.nickname, u.first_name, u.last_name, u.avatar_url, u.avatar_preset
         FROM family_members m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = $1
        ORDER BY m.role = 'leader' DESC, m.joined_at`,
      [familyId],
    );
    return rows;
  },

  /** Bloquea las filas de miembros del grupo durante la transacción (salidas y cambios de rol simultáneos). */
  async lockMembers(familyId: string, conn: Db): Promise<{ user_id: string; role: FamilyRole; joined_at: Date }[]> {
    const { rows } = await conn.query<{ user_id: string; role: FamilyRole; joined_at: Date }>(
      'SELECT user_id, role, joined_at FROM family_members WHERE family_id = $1 ORDER BY joined_at FOR UPDATE',
      [familyId],
    );
    return rows;
  },

  /** Agrega el miembro; si ya estaba, no hace nada. Devuelve true si entró ahora. */
  async addMember(familyId: string, userId: string, role: FamilyRole, conn: Db = db()): Promise<boolean> {
    const { rowCount } = await conn.query(
      'INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [familyId, userId, role],
    );
    return rowCount === 1;
  },

  setRole: (familyId: string, userId: string, role: FamilyRole, conn: Db = db()) =>
    conn.query('UPDATE family_members SET role = $3 WHERE family_id = $1 AND user_id = $2', [familyId, userId, role]),

  removeMember: (familyId: string, userId: string, conn: Db = db()) =>
    conn.query('DELETE FROM family_members WHERE family_id = $1 AND user_id = $2', [familyId, userId]),

  async familyIdsOf(userId: string, conn: Db): Promise<string[]> {
    const { rows } = await conn.query<{ family_id: string }>('SELECT family_id FROM family_members WHERE user_id = $1', [userId]);
    return rows.map((r) => r.family_id);
  },
};
