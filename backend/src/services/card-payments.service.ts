import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { runInBackground } from '../lib/background.js';
import { cardCycle, nextDue, previousDue, type CardCycle, type CardMovement } from '../lib/card-payment.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import type { CalendarEvent } from '../lib/google.js';
import { mailer } from '../lib/mailer.js';
import { todayIn } from '../lib/recurrence.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { computeAccess } from './accounts.service.js';
import { calendarService } from './calendar.service.js';
import { shouldRemind } from './reminders.service.js';

/** Tarjeta con día de pago, activa */
interface Card {
  id: string;
  family_id: string;
  owner_id: string | null;
  name: string;
  payment_day: number;
  cut_day: number | null;
  currency: string;
}

interface Person {
  id: string;
  email: string;
  locale: Locale;
  timezone: string;
  reminder_hour: number;
  start_days: number;
  every_days: number;
}

interface EventRow {
  account_id: string;
  due_date: string;
  user_id: string;
  event_id: string;
  payload_hash: string;
}

const CARD_SELECT = `
  SELECT a.id, a.family_id, a.owner_id, a.name, a.payment_day, a.cut_day, f.currency
    FROM accounts a JOIN families f ON f.id = a.family_id
   WHERE a.kind = 'credit' AND a.payment_day IS NOT NULL AND a.archived_at IS NULL`;

const intl = (locale: Locale) => (locale === 'en' ? 'en-US' : 'es-ES');
const money = (n: number, currency: string, locale: Locale) =>
  new Intl.NumberFormat(intl(locale), { style: 'currency', currency }).format(n);
const longDate = (date: string, locale: Locale) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(intl(locale), { day: 'numeric', month: 'long', timeZone: 'UTC' });
const cardUrl = (id: string) => `${env.appUrl}/finanzas?cuenta=${id}`;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function movementsOf(accountId: string): Promise<CardMovement[]> {
  const { rows } = await db().query<{ date: string; kind: string; amount: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, kind, amount FROM account_movements WHERE account_id = $1 AND deleted_at IS NULL`,
    [accountId],
  );
  return rows.map((r) => ({ date: r.date, kind: r.kind, amount: Number(r.amount) }));
}

/**
 * Quienes reciben los avisos: quien creó la tarjeta y quienes la pueden editar (sus movimientos),
 * con el correo confirmado y los avisos de finanzas activados. Con sus recordatorios de tareas.
 */
async function recipients(card: Card): Promise<Person[]> {
  const members = await familiesRepository.listMembers(card.family_id);
  const ids: string[] = [];
  for (const m of members) {
    const row = await accountsRepository.find(card.id, m.user_id);
    if (row && computeAccess(row, m.role, m.user_id).canEdit) ids.push(m.user_id);
  }
  if (!ids.length) return [];
  const { rows } = await db().query<Person>(
    `SELECT id, email, locale, timezone, reminder_hour, reminder_start_days AS start_days, reminder_every_days AS every_days
       FROM users WHERE id = ANY($1::uuid[]) AND email_finance AND email_verified_at IS NOT NULL`,
    [ids],
  );
  return rows;
}

/** Evento de todo el día en la fecha de pago: con lo que falta, o con ✓ cuando ya se pagó */
export function buildCardEvent(card: Pick<Card, 'id' | 'name' | 'currency'>, cycle: CardCycle, locale: Locale): CalendarEvent {
  const en = locale === 'en';
  const amount = money(cycle.pending, card.currency, locale);
  const summary = cycle.pending > 0 ? `💳 ${en ? 'Pay' : 'Pagar'} ${card.name} · ${amount}` : `✓ 💳 ${en ? 'Pay' : 'Pagar'} ${card.name}`;
  const lines = [
    cycle.pending > 0 ? `${en ? 'Still to pay' : 'Por pagar'}: ${amount}` : en ? 'Paid' : 'Pagada',
    ...(cycle.cut && cycle.statement !== null
      ? [`${en ? 'Statement' : 'Corte del'} ${longDate(cycle.cut, locale)}: ${money(cycle.statement, card.currency, locale)}`]
      : []),
  ];
  return {
    summary,
    description: `${lines.join('\n')}\n\n${cardUrl(card.id)}`,
    start: { date: cycle.due },
    end: { date: addDays(cycle.due, 1) },
    // Como las tareas de todo el día: aviso a las 9 del día anterior
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 * 60 }] },
  };
}

/**
 * Deja el calendario de quien creó cada tarjeta al día: el evento de la próxima fecha de pago
 * (cuando ya hay algo por pagar) y, con corte, el de la fecha anterior si fue hace menos de una
 * semana (por si se pagó tarde, para marcarlo con ✓). Los eventos viejos quedan como estaban.
 */
async function syncCalendar(accountIds: string[]): Promise<void> {
  if (!accountIds.length) return;
  const cards = new Map((await db().query<Card>(`${CARD_SELECT} AND a.id = ANY($1::uuid[])`, [accountIds])).rows.map((c) => [c.id, c]));
  const events = (await db().query<EventRow>(`SELECT account_id, to_char(due_date, 'YYYY-MM-DD') AS due_date, user_id, event_id, payload_hash
                                                FROM card_calendar_events WHERE account_id = ANY($1::uuid[])`, [accountIds])).rows;

  for (const id of new Set(accountIds)) {
    try {
      const card = cards.get(id);
      const owner = card?.owner_id
        ? (await db().query<{ timezone: string; locale: Locale }>('SELECT timezone, locale FROM users WHERE id = $1', [card.owner_id])).rows[0]
        : undefined;
      const mine = events.filter((e) => e.account_id === id);
      const today = owner ? todayIn(owner.timezone) : '';

      // Sin día de pago, archivada o de otra persona: se quitan los eventos de pagos que no han llegado
      for (const e of mine.filter((e) => !card || !owner || e.user_id !== card.owner_id)) {
        if (e.due_date < (today || todayIn('UTC'))) continue;
        await calendarService.deleteEvent(e.user_id, e.event_id);
        await db().query('DELETE FROM card_calendar_events WHERE account_id = $1 AND due_date = $2', [id, e.due_date]);
      }
      if (!card || !owner) continue;

      const movements = await movementsOf(id);
      const next = nextDue(card.payment_day, today);
      const dues = [next];
      const prev = previousDue(card.payment_day, next);
      if (card.cut_day !== null && prev >= addDays(today, -7)) dues.push(prev);

      for (const due of dues) {
        const row = mine.find((e) => e.due_date === due && e.user_id === card.owner_id);
        const cycle = cardCycle({ paymentDay: card.payment_day, cutDay: card.cut_day }, due, movements, today);
        // Solo se crea cuando ya hay algo por pagar; si existe, se actualiza (✓ al pagar)
        if (!row && cycle.pending <= 0) continue;
        const event = buildCardEvent(card, cycle, owner.locale);
        const hash = calendarService.hashOf(event);
        if (row?.payload_hash === hash) continue;
        const eventId = await calendarService.putEvent(card.owner_id!, row?.event_id ?? null, event);
        if (!eventId) break; // sin Google conectado
        await db().query(
          `INSERT INTO card_calendar_events (account_id, due_date, user_id, event_id, payload_hash) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (account_id, due_date) DO UPDATE SET user_id = EXCLUDED.user_id, event_id = EXCLUDED.event_id, payload_hash = EXCLUDED.payload_hash`,
          [id, due, card.owner_id, eventId, hash],
        );
      }
    } catch (err) {
      console.error('[calendario tarjeta]', id, err);
    }
  }
}

export const cardPaymentsService = {
  /**
   * Lo llama el envío de cada hora: correo a quien creó la tarjeta y a quienes la editan cuando
   * tiene un pago pendiente, desde X días antes de la fecha de pago, cada N días y a su hora
   * (los recordatorios de tareas de cada persona). Para cuando se registra el pago.
   */
  async run(now = new Date()): Promise<{ cardReminders: number }> {
    const cards = (await db().query<Card>(CARD_SELECT)).rows;
    let sent = 0;
    for (const card of cards) {
      const people = await recipients(card);
      if (!people.length) continue;
      const movements = await movementsOf(card.id);
      for (const p of people) {
        const today = todayIn(p.timezone, now);
        const due = nextDue(card.payment_day, today);
        const cycle = cardCycle({ paymentDay: card.payment_day, cutDay: card.cut_day }, due, movements, today);
        if (cycle.pending <= 0) continue;
        const when = shouldRemind({ due_date: due, due_at: null, start_days: p.start_days, every_days: p.every_days, timezone: p.timezone, reminder_hour: p.reminder_hour }, now);
        if (!when) continue;
        const claimed = await db().query(
          'INSERT INTO card_payment_sends (account_id, user_id, local_date, due_date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [card.id, p.id, when.localDate, due],
        );
        if (!claimed.rowCount) continue;
        try {
          await mailer.send(
            p.email,
            emailTemplates.cardPayment(p.locale, {
              card: card.name,
              amount: money(cycle.pending, card.currency, p.locale),
              date: longDate(due, p.locale),
              daysLeft: when.daysLeft,
              statement: cycle.statement !== null ? money(cycle.statement, card.currency, p.locale) : null,
              cut: cycle.cut ? longDate(cycle.cut, p.locale) : null,
              url: cardUrl(card.id),
              settingsUrl: `${env.appUrl}/perfil#notificaciones`,
            }),
          );
          sent++;
        } catch (err) {
          // Se libera para reintentar en la próxima hora
          await db().query('DELETE FROM card_payment_sends WHERE account_id = $1 AND user_id = $2 AND local_date = $3', [card.id, p.id, when.localDate]);
          console.error('[pago tarjeta]', err);
        }
      }
    }
    return { cardReminders: sent };
  },

  /** Después de un cambio en la tarjeta (movimientos o días): actualiza su evento sin hacer esperar */
  afterChange(accountIds: string[]): void {
    if (accountIds.length) runInBackground('calendario tarjeta', () => syncCalendar(accountIds));
  },

  /** Repaso de cada hora: tarjetas con día de pago y las que tienen eventos */
  async reconcile(): Promise<void> {
    const { rows } = await db().query<{ id: string }>(`SELECT id FROM (${CARD_SELECT}) c UNION SELECT DISTINCT account_id FROM card_calendar_events`);
    await syncCalendar(rows.map((r) => r.id));
  },

  syncCalendar,
};
