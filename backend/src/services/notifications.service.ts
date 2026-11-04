import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { runInBackground } from '../lib/background.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { mailer } from '../lib/mailer.js';

interface Recipient {
  id: string;
  email: string;
  locale: Locale;
  timezone: string;
}

const listUrl = (listId: string) => `${env.appUrl}/listas/${listId}`;
const settingsUrl = () => `${env.appUrl}/perfil#notificaciones`;

async function nicknameOf(userId: string): Promise<string> {
  const { rows } = await db().query<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1', [userId]);
  return rows[0]?.nickname ?? '';
}

const intlLocale = (locale: Locale) => (locale === 'en' ? 'en-US' : 'es-ES');

/** Fecha 'YYYY-MM-DD' en el idioma de quien recibe el correo */
export function formatDate(date: string, locale: Locale): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** Fecha límite con su hora (si tiene) en la zona horaria de quien recibe el correo */
export function formatDue(item: { due_date: string | null; due_at: Date | null }, locale: Locale, timezone: string): string | null {
  if (!item.due_date) return null;
  if (!item.due_at) return formatDate(item.due_date, locale);
  return item.due_at.toLocaleString(intlLocale(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/**
 * Correos que avisan de algo que hizo otra persona. Se envían en segundo plano:
 * la acción responde sin esperar a Gmail y un fallo de envío no la revierte.
 * Solo a cuentas con el correo confirmado y la preferencia activada.
 */
export const notificationsService = {
  /** Lista nueva del grupo (madePublic: era privada y pasó a ser del grupo) */
  listShared(list: { id: string; family_id: string; name: string }, actorId: string, madePublic: boolean): void {
    runInBackground('correo lista nueva', async () => {
      const { rows } = await db().query<Recipient & { family: string }>(
        `SELECT u.id, u.email, u.locale, u.timezone, f.name AS family
           FROM family_members m
           JOIN users u ON u.id = m.user_id
           JOIN families f ON f.id = m.family_id
          WHERE m.family_id = $1 AND m.user_id <> $2
            AND u.email_new_lists AND u.email_verified_at IS NOT NULL`,
        [list.family_id, actorId],
      );
      if (!rows.length) return;
      const author = await nicknameOf(actorId);
      await Promise.all(
        rows.map((r) =>
          mailer.send(
            r.email,
            emailTemplates.newList(r.locale, {
              author,
              list: list.name,
              family: r.family,
              madePublic,
              url: listUrl(list.id),
              settingsUrl: settingsUrl(),
            }),
          ),
        ),
      );
    });
  },

  /** Alguien te asignó una tarea. No avisa si te la asignas tú, ni en listas privadas. */
  assigned(
    item: { text: string; due_date: string | null; due_at: Date | null },
    list: { id: string; name: string; is_private: boolean },
    actorId: string,
    assigneeId: string | null,
  ): void {
    if (!assigneeId || assigneeId === actorId || list.is_private) return;
    runInBackground('correo asignación', async () => {
      const { rows } = await db().query<Recipient>(
        `SELECT id, email, locale, timezone FROM users
          WHERE id = $1 AND email_assignments AND email_verified_at IS NOT NULL`,
        [assigneeId],
      );
      const r = rows[0];
      if (!r) return;
      const author = await nicknameOf(actorId);
      await mailer.send(
        r.email,
        emailTemplates.assigned(r.locale, {
          author,
          task: item.text,
          list: list.name,
          due: formatDue(item, r.locale, r.timezone),
          url: listUrl(list.id),
          settingsUrl: settingsUrl(),
        }),
      );
    });
  },
};
