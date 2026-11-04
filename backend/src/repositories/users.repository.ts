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
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_preset: string | null;
  theme: unknown | null;
  email_new_lists: boolean;
  email_assignments: boolean;
  email_reminders: boolean;
  reminder_hour: number;
  reminder_start_days: number;
  reminder_every_days: number;
  created_at: Date;
}

/** Preferencias que se guardan tal cual en una columna de users */
export const USER_SETTINGS = {
  newLists: 'email_new_lists',
  assignments: 'email_assignments',
  reminders: 'email_reminders',
  reminderHour: 'reminder_hour',
  reminderStartDays: 'reminder_start_days',
  reminderEveryDays: 'reminder_every_days',
} as const;
export type UserSettings = Partial<Record<keyof typeof USER_SETTINGS, unknown>>;

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

  async updateProfile(
    id: string,
    data: { firstName?: string | null; lastName?: string | null; nickname?: string; locale?: string; timezone?: string },
  ) {
    return (await one(
      `UPDATE users SET
         first_name = CASE WHEN $2 THEN $3 ELSE first_name END,
         last_name  = CASE WHEN $4 THEN $5 ELSE last_name END,
         nickname   = COALESCE($6, nickname),
         locale     = COALESCE($7, locale),
         timezone   = COALESCE($8, timezone),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        data.firstName !== undefined,
        data.firstName ?? null,
        data.lastName !== undefined,
        data.lastName ?? null,
        data.nickname ?? null,
        data.locale ?? null,
        data.timezone ?? null,
      ],
    ))!;
  },

  async setAvatar(id: string, avatar: { url: string | null; preset: string | null }) {
    return (await one(
      'UPDATE users SET avatar_url = $2, avatar_preset = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [id, avatar.url, avatar.preset],
    ))!;
  },

  async setTheme(id: string, theme: unknown | null) {
    return (await one('UPDATE users SET theme = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, theme]))!;
  },

  async setSettings(id: string, settings: UserSettings) {
    const entries = Object.entries(settings).filter(([, v]) => v !== undefined) as [keyof typeof USER_SETTINGS, unknown][];
    const sets = entries.map(([key], i) => `${USER_SETTINGS[key]} = $${i + 2}`);
    return (await one(
      `UPDATE users SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...entries.map(([, v]) => v)],
    ))!;
  },

  updateEmail: (id: string, email: string, conn: Db) =>
    conn.query('UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1', [id, email]),

  delete: (id: string, conn: Db = db()) => conn.query('DELETE FROM users WHERE id = $1', [id]),

  updatePassword: (id: string, passwordHash: string, conn: Db) =>
    conn.query(
      `UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1`,
      [id, passwordHash],
    ),
};
