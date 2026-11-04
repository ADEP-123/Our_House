import { db, type Db } from '../config/database.js';

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
}

export const sessionsRepository = {
  async create(userId: string, tokenHash: string, expiresAt: Date, userAgent: string | undefined): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      'INSERT INTO sessions (user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, tokenHash, expiresAt, userAgent?.slice(0, 300) ?? null],
    );
    return rows[0]!.id;
  },

  async findById(id: string): Promise<SessionRow | null> {
    const { rows } = await db().query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  rotate: (id: string, tokenHash: string, expiresAt: Date) =>
    db().query('UPDATE sessions SET token_hash = $2, expires_at = $3, last_used_at = now() WHERE id = $1', [
      id,
      tokenHash,
      expiresAt,
    ]),

  delete: (id: string) => db().query('DELETE FROM sessions WHERE id = $1', [id]),

  /** Cierra las demás sesiones del usuario y deja viva la actual. */
  deleteOthers: (userId: string, keepSessionId: string) =>
    db().query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, keepSessionId]),

  deleteAllForUser: (userId: string, conn: Db = db()) => conn.query('DELETE FROM sessions WHERE user_id = $1', [userId]),
};
