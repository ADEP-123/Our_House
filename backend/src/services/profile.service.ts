import { withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { detectImage, MAX_AVATAR_BYTES } from '../lib/avatars.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http-error.js';
import { mailer } from '../lib/mailer.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { addMs, DAY, hashToken, newToken } from '../lib/tokens.js';
import { emailTokensRepository } from '../repositories/email-tokens.repository.js';
import { sessionsRepository } from '../repositories/sessions.repository.js';
import { usersRepository, type UserRow, type UserSettings } from '../repositories/users.repository.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { removeFromFamily } from './families.service.js';
import { storageService } from './storage.service.js';
import { toUserView, type UserView } from './user-view.js';

async function getUser(userId: string): Promise<UserRow> {
  const user = await usersRepository.findById(userId);
  if (!user) throw notFound();
  return user;
}

async function requirePassword(user: UserRow, password: string): Promise<void> {
  if (!(await verifyPassword(user.password_hash, password))) throw forbidden('WRONG_PASSWORD');
}

export const profileService = {
  async update(
    userId: string,
    data: { firstName?: string | null; lastName?: string | null; nickname?: string; locale?: Locale; timezone?: string },
  ): Promise<UserView> {
    if (data.nickname) {
      const owner = await usersRepository.findByNickname(data.nickname);
      if (owner && owner.id !== userId) throw conflict('NICKNAME_TAKEN');
    }
    try {
      return toUserView(await usersRepository.updateProfile(userId, data));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('NICKNAME_TAKEN');
      throw err;
    }
  },

  /** Cambia la contraseña y cierra las demás sesiones; la actual sigue abierta. */
  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await getUser(userId);
    await requirePassword(user, currentPassword);
    const passwordHash = await hashPassword(newPassword);
    await withTransaction((conn) => usersRepository.updatePassword(userId, passwordHash, conn));
    await sessionsRepository.deleteOthers(userId, sessionId);
  },

  /** Envía el enlace al correo nuevo; el cambio solo se aplica al confirmarlo. */
  async requestEmailChange(userId: string, newEmail: string, password: string): Promise<void> {
    const user = await getUser(userId);
    await requirePassword(user, password);
    if (newEmail === user.email) throw badRequest('EMAIL_UNCHANGED');
    if (await usersRepository.findByEmail(newEmail)) throw conflict('EMAIL_TAKEN');

    const token = newToken();
    await emailTokensRepository.replace({
      userId,
      purpose: 'change_email',
      tokenHash: hashToken(token),
      expiresAt: addMs(DAY),
      newEmail,
    });
    await mailer.send(
      newEmail,
      emailTemplates.confirmEmailChange(user.locale as Locale, {
        nickname: user.nickname,
        url: `${env.appUrl}/confirmar-correo?token=${token}`,
      }),
    );
  },

  /** Aplica el correo nuevo y avisa al anterior. No exige sesión: el token prueba que el correo es suyo. */
  async confirmEmailChange(token: string): Promise<void> {
    const { user, newEmail } = await withTransaction(async (conn) => {
      const row = await emailTokensRepository.findByHash(hashToken(token), 'change_email', conn);
      if (!row || row.used_at || !row.new_email) throw badRequest('TOKEN_INVALID');
      if (row.expires_at < new Date()) throw badRequest('TOKEN_EXPIRED');
      await emailTokensRepository.markUsed(row.id, conn);

      const owner = await usersRepository.findByEmail(row.new_email, conn);
      if (owner) throw conflict('EMAIL_TAKEN');
      const user = (await usersRepository.findById(row.user_id, conn))!;
      await usersRepository.updateEmail(row.user_id, row.new_email, conn);
      return { user, newEmail: row.new_email };
    });
    await mailer.send(user.email, emailTemplates.emailChangedNotice(user.locale as Locale, { nickname: user.nickname, newEmail }));
  },

  async uploadAvatar(userId: string, data: Buffer): Promise<UserView> {
    if (!data?.length) throw badRequest('FILE_REQUIRED');
    if (data.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE');
    const image = detectImage(data);
    if (!image) throw badRequest('FILE_TYPE_NOT_ALLOWED');

    const user = await getUser(userId);
    const url = await storageService.upload(`avatars/users/${userId}.${image.ext}`, data, image.type);
    const updated = await usersRepository.setAvatar(userId, { url, preset: null });
    await storageService.remove(user.avatar_url);
    return toUserView(updated);
  },

  /** preset = null deja las iniciales. */
  async setAvatarPreset(userId: string, preset: string | null): Promise<UserView> {
    const user = await getUser(userId);
    const updated = await usersRepository.setAvatar(userId, { url: null, preset });
    await storageService.remove(user.avatar_url);
    return toUserView(updated);
  },

  /** Marca un tutorial como visto o saltado, o guarda en qué paso quedó */
  async setTutorial(userId: string, tutorial: string, value: { state: string; step?: number }): Promise<UserView> {
    return toUserView(await usersRepository.setTutorial(userId, tutorial, value));
  },

  async setSettings(userId: string, settings: UserSettings): Promise<UserView> {
    return toUserView(await usersRepository.setSettings(userId, settings));
  },

  /** theme = null vuelve al tema claro por defecto. */
  async setTheme(userId: string, theme: unknown | null): Promise<UserView> {
    return toUserView(await usersRepository.setTheme(userId, theme));
  },

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await getUser(userId);
    await requirePassword(user, password);
    // Sale de cada grupo con la misma regla que "salir del grupo": el liderazgo pasa al miembro
    // más antiguo y los grupos que quedan vacíos se eliminan
    const orphanAvatars = await withTransaction(async (conn) => {
      const avatars: (string | null)[] = [];
      for (const familyId of await familiesRepository.familyIdsOf(userId, conn)) {
        avatars.push(await removeFromFamily(familyId, userId, conn));
      }
      await usersRepository.delete(userId, conn);
      return avatars;
    });
    await Promise.all([user.avatar_url, ...orphanAvatars].map((url) => storageService.remove(url)));
  },
};
