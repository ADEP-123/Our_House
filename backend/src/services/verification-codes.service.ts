import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { badRequest, HttpError } from '../lib/http-error.js';
import { mailer } from '../lib/mailer.js';

export type CodePurpose = 'secrets';

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;

/** Huella del código ligada a la persona y al uso: la base de datos nunca guarda el código */
const hashCode = (userId: string, purpose: CodePurpose, code: string) =>
  createHmac('sha256', env.jwtSecret).update(`${userId}:${purpose}:${code}`).digest('base64url');

interface CodeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

/**
 * Código de verificación por correo: 6 dígitos, vence a los 10 minutos, un solo uso, 5 intentos.
 * Pedir uno nuevo anula el anterior y solo se puede cada 60 segundos.
 */
export const verificationCodesService = {
  async request(userId: string, purpose: CodePurpose): Promise<{ expiresAt: Date; resendIn: number }> {
    const { rows: last } = await db().query<CodeRow>(
      'SELECT * FROM verification_codes WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1',
      [userId, purpose],
    );
    const elapsed = last[0] ? (Date.now() - last[0].created_at.getTime()) / 1000 : Infinity;
    if (elapsed < RESEND_SECONDS) throw new HttpError(429, 'CODE_COOLDOWN', { retryIn: Math.ceil(RESEND_SECONDS - elapsed) });

    const { rows: users } = await db().query<{ email: string; locale: Locale; nickname: string }>(
      'SELECT email, locale, nickname FROM users WHERE id = $1',
      [userId],
    );
    const user = users[0]!;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);
    await db().query('UPDATE verification_codes SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
    await db().query('INSERT INTO verification_codes (user_id, purpose, code_hash, expires_at) VALUES ($1, $2, $3, $4)', [
      userId,
      purpose,
      hashCode(userId, purpose, code),
      expiresAt,
    ]);
    await mailer.send(user.email, emailTemplates.verificationCode(user.locale, { nickname: user.nickname, code, purpose, minutes: TTL_MINUTES }));
    return { expiresAt, resendIn: RESEND_SECONDS };
  },

  /** Consume el código si es correcto; si no, cuenta el intento y explica por qué falló. */
  async verify(userId: string, purpose: CodePurpose, code: string): Promise<void> {
    const { rows } = await db().query<CodeRow>(
      `SELECT * FROM verification_codes
        WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId, purpose],
    );
    const row = rows[0];
    if (!row || row.expires_at.getTime() < Date.now()) throw badRequest('CODE_EXPIRED');
    if (row.attempts >= MAX_ATTEMPTS) throw badRequest('CODE_TOO_MANY_ATTEMPTS');

    const given = Buffer.from(hashCode(userId, purpose, code.trim()));
    const expected = Buffer.from(row.code_hash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      const { rows: updated } = await db().query<{ attempts: number }>(
        'UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
        [row.id],
      );
      const attemptsLeft = MAX_ATTEMPTS - updated[0]!.attempts;
      throw attemptsLeft > 0 ? badRequest('CODE_INVALID', { attemptsLeft }) : badRequest('CODE_TOO_MANY_ATTEMPTS');
    }
    // Un solo uso (si dos pedidos llegan a la vez, solo uno lo consume)
    const { rowCount } = await db().query('UPDATE verification_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL', [row.id]);
    if (!rowCount) throw badRequest('CODE_EXPIRED');
  },
};
