import { db, type Db } from '../config/database.js';

export interface UserRow {
  id: string;
  email: string;
  nickname: string;
  password_hash: string;
  locale: 'es' | 'en';
  timezone: string;
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  created_at: Date;
}

const one = async (sql: string, params: unknown[], conn: Db = db()): Promise<UserRow | null> =>
  (await conn.query<UserRow>(sql, params)).rows[0] ?? null;

export const usersRepository = {
  findById: (id: string, conn?: Db) => one('SELECT * FROM users WHERE id = $1', [id], conn),

  findByEmail: (email: string, conn?: Db) => one('SELECT * FROM users WHERE email = $1', [email], conn),

  findByNickname: (nickname: string, conn?: Db) => one('SELECT * FROM users WHERE nickname = $1', [nickname], conn),

  /** Busca por correo o por apodo (citext: sin distinguir mayúsculas). */
  findByIdentifier: (identifier: string) =>
    one('SELECT * FROM users WHERE email = $1 OR nickname = $1 LIMIT 1', [identifier]),

  async create(data: { email: string; nickname: string; passwordHash: string; locale: string; timezone: string }) {
    return (await one(
      `INSERT INTO users (email, nickname, password_hash, locale, timezone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.email, data.nickname, data.passwordHash, data.locale, data.timezone],
    ))!;
  },

  markEmailVerified: (id: string, conn: Db) =>
    conn.query('UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1', [id]),

  /** Suma un intento fallido y bloquea la cuenta al llegar al máximo. Devuelve el estado resultante. */
  async registerFailedLogin(id: string, maxAttempts: number, lockMinutes: number) {
    return (await one(
      `UPDATE users SET
         failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1 RETURNING *`,
      [id, maxAttempts, lockMinutes],
    ))!;
  },

  resetFailedLogins: (id: string) =>
    db().query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [id]),

  updatePassword: (id: string, passwordHash: string, conn: Db) =>
    conn.query(
      `UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1`,
      [id, passwordHash],
    ),
};
