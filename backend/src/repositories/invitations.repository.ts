import { db, type Db } from '../config/database.js';

export type StoredStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface InvitationRow {
  id: string;
  family_id: string;
  invited_by: string | null;
  email: string;
  invited_user_id: string | null;
  status: StoredStatus;
  expires_at: Date;
  created_at: Date;
  responded_at: Date | null;
}

export interface InvitationListRow extends InvitationRow {
  inviter_nickname: string | null;
}

export interface MyInvitationRow extends InvitationRow {
  inviter_nickname: string | null;
  family_name: string;
  family_avatar_url: string | null;
  family_avatar_preset: string | null;
}

export const invitationsRepository = {
  async create(data: { familyId: string; invitedBy: string; email: string; invitedUserId: string | null; expiresAt: Date }) {
    const { rows } = await db().query<InvitationRow>(
      `INSERT INTO family_invitations (family_id, invited_by, email, invited_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.familyId, data.invitedBy, data.email, data.invitedUserId, data.expiresAt],
    );
    return rows[0]!;
  },

  async findById(id: string, conn: Db = db()): Promise<InvitationRow | null> {
    return (await conn.query<InvitationRow>('SELECT * FROM family_invitations WHERE id = $1 FOR UPDATE', [id])).rows[0] ?? null;
  },

  async findPending(familyId: string, email: string): Promise<InvitationRow | null> {
    const { rows } = await db().query<InvitationRow>(
      "SELECT * FROM family_invitations WHERE family_id = $1 AND email = $2 AND status = 'pending'",
      [familyId, email],
    );
    return rows[0] ?? null;
  },

  async listForFamily(familyId: string): Promise<InvitationListRow[]> {
    const { rows } = await db().query<InvitationListRow>(
      `SELECT i.*, u.nickname AS inviter_nickname
         FROM family_invitations i LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.family_id = $1
        ORDER BY i.created_at DESC
        LIMIT 50`,
      [familyId],
    );
    return rows;
  },

  /** Invitaciones vigentes para el usuario: por su correo actual o porque lo invitaron por apodo. */
  async listPendingFor(userId: string, email: string): Promise<MyInvitationRow[]> {
    const { rows } = await db().query<MyInvitationRow>(
      `SELECT i.*, u.nickname AS inviter_nickname, f.name AS family_name,
              f.avatar_url AS family_avatar_url, f.avatar_preset AS family_avatar_preset
         FROM family_invitations i
         JOIN families f ON f.id = i.family_id
         LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.status = 'pending' AND i.expires_at > now()
          AND (i.email = $2 OR i.invited_user_id = $1)
          AND NOT EXISTS (SELECT 1 FROM family_members m WHERE m.family_id = i.family_id AND m.user_id = $1)
        ORDER BY i.created_at DESC`,
      [userId, email],
    );
    return rows;
  },

  setStatus: (id: string, status: StoredStatus, conn: Db = db()) =>
    conn.query('UPDATE family_invitations SET status = $2, responded_at = now() WHERE id = $1', [id, status]),

  renew: (id: string, expiresAt: Date) =>
    db().query("UPDATE family_invitations SET status = 'pending', expires_at = $2, responded_at = NULL WHERE id = $1", [
      id,
      expiresAt,
    ]),

  /** Al entrar al grupo (por código o por otra invitación) las demás invitaciones de ese grupo dejan de tener sentido. */
  acceptAllFor: (familyId: string, userId: string, email: string, conn: Db) =>
    conn.query(
      `UPDATE family_invitations SET status = 'accepted', responded_at = now()
        WHERE family_id = $1 AND status = 'pending' AND (email = $3 OR invited_user_id = $2)`,
      [familyId, userId, email],
    ),
};
