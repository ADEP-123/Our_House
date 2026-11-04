import { withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../lib/http-error.js';
import { signAccessToken } from '../lib/jwt.js';
import { mailer } from '../lib/mailer.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { addMs, DAY, hashToken, HOUR, newToken } from '../lib/tokens.js';
import { emailTokensRepository, type EmailTokenPurpose } from '../repositories/email-tokens.repository.js';
import { sessionsRepository } from '../repositories/sessions.repository.js';
import { usersRepository, type UserRow } from '../repositories/users.repository.js';
import { toUserView, type UserView } from './user-view.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const SESSION_TTL = 30 * DAY;
const RESEND_COOLDOWN_MS = 60 * 1000;

export interface AuthResult {
  user: UserView;
  accessToken: string;
  /** Valor de la cookie de refresh: "<id de sesión>.<secreto>" */
  refreshToken: string;
}

const isUniqueViolation = (err: unknown): err is { code: string; constraint?: string } =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

async function startSession(user: UserRow, userAgent?: string): Promise<AuthResult> {
  const secret = newToken();
  const sessionId = await sessionsRepository.create(user.id, hashToken(secret), addMs(SESSION_TTL), userAgent);
  return {
    user: toUserView(user),
    accessToken: await signAccessToken({ userId: user.id, sessionId }),
    refreshToken: `${sessionId}.${secret}`,
  };
}

/** Valida un token de correo y lo marca como usado dentro de la transacción. */
async function consumeEmailToken(token: string, purpose: EmailTokenPurpose, conn: Parameters<typeof emailTokensRepository.markUsed>[1]) {
  const row = await emailTokensRepository.findByHash(hashToken(token), purpose, conn);
  if (!row || row.used_at) throw badRequest('TOKEN_INVALID');
  if (row.expires_at < new Date()) throw badRequest('TOKEN_EXPIRED');
  await emailTokensRepository.markUsed(row.id, conn);
  return row;
}

async function sendVerification(user: UserRow): Promise<void> {
  const token = newToken();
  await emailTokensRepository.replace({
    userId: user.id,
    purpose: 'verify_email',
    tokenHash: hashToken(token),
    expiresAt: addMs(DAY),
  });
  await mailer.send(
    user.email,
    emailTemplates.verifyEmail(user.locale as Locale, {
      nickname: user.nickname,
      url: `${env.appUrl}/verificar-correo?token=${token}`,
    }),
  );
}

export const authService = {
  async isNicknameAvailable(nickname: string): Promise<boolean> {
    return !(await usersRepository.findByNickname(nickname));
  },

  async register(input: { email: string; nickname: string; password: string; locale: Locale; timezone: string }) {
    if (await usersRepository.findByEmail(input.email)) throw conflict('EMAIL_TAKEN');
    if (await usersRepository.findByNickname(input.nickname)) throw conflict('NICKNAME_TAKEN');

    let user: UserRow;
    try {
      user = await usersRepository.create({ ...input, passwordHash: await hashPassword(input.password) });
    } catch (err) {
      // Dos registros simultáneos con el mismo dato: gana el primero
      if (isUniqueViolation(err)) throw conflict(err.constraint?.includes('nickname') ? 'NICKNAME_TAKEN' : 'EMAIL_TAKEN');
      throw err;
    }
    await sendVerification(user);
    return { email: user.email };
  },

  async verifyEmail(token: string, userAgent?: string): Promise<AuthResult> {
    const userId = await withTransaction(async (conn) => {
      const row = await consumeEmailToken(token, 'verify_email', conn);
      await usersRepository.markEmailVerified(row.user_id, conn);
      return row.user_id;
    });
    // Confirmar el correo deja la sesión iniciada
    return startSession((await usersRepository.findById(userId))!, userAgent);
  },

  /** Responde igual exista o no la cuenta, para no revelar qué correos están registrados. */
  async resendVerification(email: string): Promise<void> {
    const user = await usersRepository.findByEmail(email);
    if (!user || user.email_verified_at) return;
    const last = await emailTokensRepository.latest(user.id, 'verify_email');
    if (last && Date.now() - last.created_at.getTime() < RESEND_COOLDOWN_MS) return;
    await sendVerification(user);
  },

  async login(identifier: string, password: string, userAgent?: string): Promise<AuthResult> {
    const user = await usersRepository.findByIdentifier(identifier);
    if (!user) throw unauthorized('INVALID_CREDENTIALS');

    if (user.locked_until && user.locked_until > new Date()) {
      throw new HttpError(423, 'ACCOUNT_LOCKED', { lockedUntil: user.locked_until.toISOString() });
    }

    if (!(await verifyPassword(user.password_hash, password))) {
      const updated = await usersRepository.registerFailedLogin(user.id, MAX_FAILED_LOGINS, LOCK_MINUTES);
      if (updated.locked_until && updated.locked_until > new Date()) {
        throw new HttpError(423, 'ACCOUNT_LOCKED', { lockedUntil: updated.locked_until.toISOString() });
      }
      throw new HttpError(401, 'INVALID_CREDENTIALS', {
        attemptsLeft: MAX_FAILED_LOGINS - updated.failed_login_count,
      });
    }

    await usersRepository.resetFailedLogins(user.id);
    if (!user.email_verified_at) throw forbidden('EMAIL_NOT_VERIFIED', { email: user.email });
    return startSession(user, userAgent);
  },

  /** Cambia el secreto del refresh token en cada uso; un secreto viejo reutilizado cierra la sesión. */
  async refresh(refreshToken: string | undefined): Promise<Omit<AuthResult, 'user'>> {
    const [sessionId, secret] = refreshToken?.split('.') ?? [];
    if (!sessionId || !secret || !/^[0-9a-f-]{36}$/.test(sessionId)) throw unauthorized();

    const session = await sessionsRepository.findById(sessionId);
    if (!session) throw unauthorized();
    if (session.token_hash !== hashToken(secret) || session.expires_at < new Date()) {
      await sessionsRepository.delete(session.id);
      throw unauthorized();
    }

    const nextSecret = newToken();
    await sessionsRepository.rotate(session.id, hashToken(nextSecret), addMs(SESSION_TTL));
    return {
      accessToken: await signAccessToken({ userId: session.user_id, sessionId: session.id }),
      refreshToken: `${session.id}.${nextSecret}`,
    };
  },

  async logout(refreshToken: string | undefined): Promise<void> {
    const sessionId = refreshToken?.split('.')[0];
    if (sessionId && /^[0-9a-f-]{36}$/.test(sessionId)) await sessionsRepository.delete(sessionId);
  },

  logoutAll: (userId: string) => sessionsRepository.deleteAllForUser(userId),

  async forgotPassword(email: string): Promise<void> {
    const user = await usersRepository.findByEmail(email);
    if (!user) return;
    const token = newToken();
    await emailTokensRepository.replace({
      userId: user.id,
      purpose: 'reset_password',
      tokenHash: hashToken(token),
      expiresAt: addMs(HOUR),
    });
    await mailer.send(
      user.email,
      emailTemplates.resetPassword(user.locale as Locale, {
        nickname: user.nickname,
        url: `${env.appUrl}/restablecer-contrasena?token=${token}`,
      }),
    );
  },

  /** Cambia la contraseña y cierra todas las sesiones abiertas. Abrir el enlace también confirma el correo. */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await withTransaction(async (conn) => {
      const row = await consumeEmailToken(token, 'reset_password', conn);
      await usersRepository.updatePassword(row.user_id, passwordHash, conn);
      await conn.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [
        row.user_id,
      ]);
      await sessionsRepository.deleteAllForUser(row.user_id, conn);
    });
  },

  async me(userId: string): Promise<UserView> {
    const user = await usersRepository.findById(userId);
    if (!user) throw unauthorized();
    return toUserView(user);
  },
};
