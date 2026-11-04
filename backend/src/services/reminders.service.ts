import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { mailer } from '../lib/mailer.js';
import { formatDue } from './notifications.service.js';

/** Tarea pendiente con fecha y la persona que recibe sus recordatorios (responsable o, si no hay, quien la creó) */
interface Candidate {
  item_id: string;
  text: string;
  list_id: string;
  list_name: string;
  due_date: string;
  due_at: Date | null;
  start_days: number;
  every_days: number;
  user_id: string;
  email: string;
  locale: Locale;
  timezone: string;
  reminder_hour: number;
}

/** Fecha 'AAAA-MM-DD' y hora (0-23) en una zona horaria */
export function localParts(at: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * ¿Toca recordar hoy, a esta hora? Desde `start` días antes, cada `every` días, y siempre el día límite.
 * La hora de envío es la de la persona; el día límite, si la tarea vence antes, se adelanta a 2 horas antes.
 */
export function shouldRemind(c: Pick<Candidate, 'due_date' | 'due_at' | 'start_days' | 'every_days' | 'timezone' | 'reminder_hour'>, now: Date) {
  const local = localParts(now, c.timezone);
  const daysLeft = daysBetween(local.date, c.due_date);
  if (daysLeft < 0 || daysLeft > c.start_days) return null;
  if (c.due_at && c.due_at.getTime() <= now.getTime()) return null;
  if (daysLeft > 0 && (c.start_days - daysLeft) % c.every_days !== 0) return null;
  let hour = c.reminder_hour;
  if (daysLeft === 0 && c.due_at) {
    const dueLocal = localParts(c.due_at, c.timezone);
    if (dueLocal.date === local.date) hour = Math.min(hour, Math.max(0, dueLocal.hour - 2));
  }
  // El envío corre cada hora y puede atrasarse: cuenta desde la hora elegida en adelante, una vez por día
  return local.hour >= hour ? { localDate: local.date, daysLeft } : null;
}

export const remindersService = {
  /** Lo llama el workflow de GitHub cada hora. Devuelve cuántos correos se enviaron. */
  async run(now = new Date()): Promise<{ sent: number }> {
    const { rows } = await db().query<Candidate>(
      `SELECT i.id AS item_id, i.text, l.id AS list_id, l.name AS list_name, i.due_date,
              CASE WHEN i.due_time IS NOT NULL THEN (i.due_date + i.due_time) AT TIME ZONE COALESCE(i.due_tz, 'UTC') END AS due_at,
              COALESCE(i.reminder_start_days, u.reminder_start_days) AS start_days,
              COALESCE(i.reminder_every_days, u.reminder_every_days) AS every_days,
              u.id AS user_id, u.email, u.locale, u.timezone, u.reminder_hour
         FROM list_items i
         JOIN lists l ON l.id = i.list_id
         JOIN users u ON u.id = COALESCE(i.assignee_id, i.created_by)
         JOIN family_members m ON m.family_id = l.family_id AND m.user_id = u.id
        WHERE i.completed_at IS NULL AND i.due_date IS NOT NULL AND NOT i.reminders_off
          AND l.type = 'todo' AND l.archived_at IS NULL
          AND (NOT l.is_private OR l.created_by = u.id)
          AND u.email_reminders AND u.email_verified_at IS NOT NULL
          -- Margen amplio: el cálculo exacto por zona horaria se hace abajo
          AND i.due_date BETWEEN ($1::timestamptz - interval '1 day')::date
                             AND ($1::timestamptz + make_interval(days => COALESCE(i.reminder_start_days, u.reminder_start_days) + 1))::date`,
      [now],
    );

    let sent = 0;
    for (const c of rows) {
      const due = shouldRemind(c, now);
      if (!due) continue;
      // Reserva el envío de hoy; si otro proceso ya lo hizo, no se repite
      const claimed = await db().query(
        'INSERT INTO reminder_sends (item_id, user_id, local_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [c.item_id, c.user_id, due.localDate],
      );
      if (!claimed.rowCount) continue;
      try {
        await mailer.send(
          c.email,
          emailTemplates.reminder(c.locale, {
            task: c.text,
            list: c.list_name,
            daysLeft: due.daysLeft,
            due: formatDue(c, c.locale, c.timezone)!,
            url: `${env.appUrl}/listas/${c.list_id}`,
            settingsUrl: `${env.appUrl}/perfil#notificaciones`,
          }),
        );
        sent++;
      } catch (err) {
        // Se libera para reintentar en la próxima hora
        await db().query('DELETE FROM reminder_sends WHERE item_id = $1 AND user_id = $2 AND local_date = $3', [c.item_id, c.user_id, due.localDate]);
        console.error('[recordatorio]', err);
      }
    }
    return { sent };
  },
};
