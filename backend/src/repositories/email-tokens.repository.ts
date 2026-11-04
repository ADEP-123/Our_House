import { db, type Db } from '../config/database.js';

export type EmailTokenPurpose = 'verify_email' | 'reset_password' | 'change_email';

export interface EmailTokenRow {
  id: string;
  user_id: string;
  purpose: EmailTokenPurpose;
  new_email: string | null;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export const emailTokensRepository = {
  /** Crea un token nuevo e invalida los anteriores del mismo tipo: solo vale el último enlace enviado. */
  async replace(data: {
    userId: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    newEmail?: string;
  }): Promise<void> {
    const conn = db();
    await conn.query(
      'UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL',
      [data.userId, data.purpose],
    );
    await conn.query(
      `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at, new_email)
       VALUES ($1, $2, $3, $4, $5)`,
      [data.userId, data.purpose, data.tokenHash, data.expiresAt, data.newEmail ?? null],
    );
  },

  async findByHash(tokenHash: string, purpose: EmailTokenPurpose, conn: Db = db()): Promise<EmailTokenRow | null> {
    const { rows } = await conn.query<EmailTokenRow>(
      'SELECT * FROM email_tokens WHERE token_hash = $1 AND purpose = $2 FOR UPDATE',
      [tokenHash, purpose],
    );
    return rows[0] ?? null;
  },

  async latest(userId: string, purpose: EmailTokenPurpose): Promise<EmailTokenRow | null> {
    const { rows } = await db().query<EmailTokenRow>(
      'SELECT * FROM email_tokens WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1',
      [userId, purpose],
    );
    return rows[0] ?? null;
  },

  markUsed: (id: string, conn: Db) => conn.query('UPDATE email_tokens SET used_at = now() WHERE id = $1', [id]),
};
