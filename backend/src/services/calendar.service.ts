import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { runInBackground } from '../lib/background.js';
import { google, googleAvailable, GoogleError, type CalendarEvent } from '../lib/google.js';
import { badRequest, HttpError } from '../lib/http-error.js';
import { open, seal } from '../lib/secret-box.js';

interface Account {
  user_id: string;
  google_email: string;
  refresh_token_enc: string;
  calendar_id: string;
}

/** Tarea que debería estar en el calendario de alguien */
interface Wanted {
  id: string;
  text: string;
  due_date: string;
  due_tz: string | null;
  due_at: Date | null;
  completed_at: Date | null;
  list_id: string;
  list_name: string;
  user_id: string;
  calendar_id: string;
}

interface EventRow {
  item_id: string;
  user_id: string;
  event_id: string;
  payload_hash: string;
}

const CALENDAR_NAME = 'Our House';
const STATE_TTL = '10m';
const secretKey = () => new TextEncoder().encode(env.jwtSecret);

// ---------- Tokens de acceso (duran 1 hora; se renuevan con el refresh token) ----------

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

class AccountGone extends Error {}

async function accessTokenFor(account: Account): Promise<string> {
  const cached = accessTokens.get(account.user_id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  try {
    const { access_token, expires_in } = await google.refresh(open(account.refresh_token_enc));
    accessTokens.set(account.user_id, { token: access_token, expiresAt: Date.now() + expires_in * 1000 });
    return access_token;
  } catch (err) {
    // La persona quitó el permiso desde su cuenta de Google: queda desconectada
    if (err instanceof GoogleError && err.revoked) {
      await db().query('DELETE FROM google_accounts WHERE user_id = $1', [account.user_id]);
      accessTokens.delete(account.user_id);
      throw new AccountGone();
    }
    throw err;
  }
}

// ---------- Contenido del evento ----------

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Evento de la tarea: con hora, 30 minutos con aviso 30 minutos antes; sin hora, todo el día con aviso a las 9 del día anterior. */
export function buildEvent(w: Pick<Wanted, 'text' | 'due_date' | 'due_tz' | 'due_at' | 'completed_at' | 'list_id' | 'list_name'>): CalendarEvent {
  const summary = w.completed_at ? `✓ ${w.text}` : w.text;
  const description = `${w.list_name}\n${env.appUrl}/listas/${w.list_id}`;
  if (w.due_at) {
    const timeZone = w.due_tz ?? 'UTC';
    return {
      summary,
      description,
      start: { dateTime: w.due_at.toISOString(), timeZone },
      end: { dateTime: new Date(w.due_at.getTime() + 30 * 60_000).toISOString(), timeZone },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    };
  }
  return {
    summary,
    description,
    start: { date: w.due_date },
    end: { date: addDays(w.due_date, 1) },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 * 60 }] },
  };
}

const hashOf = (event: CalendarEvent) => createHash('sha256').update(JSON.stringify(event)).digest('base64url');
const isGone = (err: unknown) => err instanceof GoogleError && (err.status === 404 || err.status === 410);

// ---------- Sincronización ----------

const WANTED_SELECT = `
  SELECT i.id, i.text, i.due_date, i.due_tz, i.completed_at, l.id AS list_id, l.name AS list_name,
         CASE WHEN i.due_time IS NOT NULL THEN (i.due_date + i.due_time) AT TIME ZONE COALESCE(i.due_tz, 'UTC') END AS due_at,
         ga.user_id, ga.calendar_id
    FROM list_items i
    JOIN lists l ON l.id = i.list_id
    JOIN google_accounts ga ON ga.user_id = COALESCE(i.assignee_id, i.created_by)
    JOIN family_members m ON m.family_id = l.family_id AND m.user_id = ga.user_id
   WHERE i.due_date IS NOT NULL AND 'due' = ANY(l.features) AND l.archived_at IS NULL
     AND (NOT l.is_private OR l.created_by = ga.user_id)`;

async function accountOf(userId: string): Promise<Account | null> {
  return (await db().query<Account>('SELECT * FROM google_accounts WHERE user_id = $1', [userId])).rows[0] ?? null;
}

/**
 * Deja el calendario de cada persona igual a sus tareas: crea, actualiza (✓ al completar) o borra eventos.
 * Las tareas con fecha van al calendario de su responsable o, si no tiene, de quien la creó.
 */
async function sync(itemIds: string[]): Promise<void> {
  if (!itemIds.length || !googleAvailable()) return;
  const wanted = new Map((await db().query<Wanted>(`${WANTED_SELECT} AND i.id = ANY($1)`, [itemIds])).rows.map((w) => [w.id, w]));
  const existing = (await db().query<EventRow>('SELECT * FROM calendar_events WHERE item_id = ANY($1)', [itemIds])).rows;
  const accounts = new Map<string, Account | null>();
  const account = async (userId: string) => {
    if (!accounts.has(userId)) accounts.set(userId, await accountOf(userId));
    return accounts.get(userId)!;
  };

  for (const itemId of new Set(itemIds)) {
    const w = wanted.get(itemId);
    try {
      // Eventos que sobran: la tarea se borró, perdió la fecha o cambió de responsable
      for (const row of existing.filter((e) => e.item_id === itemId && e.user_id !== w?.user_id)) {
        const acc = await account(row.user_id);
        if (acc) await google.deleteEvent(await accessTokenFor(acc), acc.calendar_id, row.event_id).catch((err) => { if (!isGone(err)) throw err; });
        await db().query('DELETE FROM calendar_events WHERE item_id = $1 AND user_id = $2', [row.item_id, row.user_id]);
      }
      if (!w) continue;

      const acc = (await account(w.user_id))!;
      const event = buildEvent(w);
      const hash = hashOf(event);
      const row = existing.find((e) => e.item_id === itemId && e.user_id === w.user_id);
      if (row?.payload_hash === hash) continue;

      const token = await accessTokenFor(acc);
      let eventId = row?.event_id;
      if (eventId) {
        try {
          await google.updateEvent(token, acc.calendar_id, eventId, event);
        } catch (err) {
          // La persona borró el evento en Google: se vuelve a crear
          if (!isGone(err)) throw err;
          eventId = undefined;
        }
      }
      eventId ??= await google.insertEvent(token, acc.calendar_id, event);
      await db().query(
        `INSERT INTO calendar_events (item_id, user_id, event_id, payload_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id, user_id) DO UPDATE SET event_id = EXCLUDED.event_id, payload_hash = EXCLUDED.payload_hash`,
        [itemId, w.user_id, eventId, hash],
      );
    } catch (err) {
      if (!(err instanceof AccountGone)) console.error('[calendario]', itemId, err);
    }
  }
}

async function itemIdsOfList(listId: string): Promise<string[]> {
  const { rows } = await db().query<{ id: string }>(
    `SELECT id FROM list_items WHERE list_id = $1
     UNION SELECT ce.item_id FROM calendar_events ce JOIN list_items i ON i.id = ce.item_id WHERE i.list_id = $1`,
    [listId],
  );
  return rows.map((r) => r.id);
}

export const calendarService = {
  /** Sincroniza en segundo plano: la acción de la persona no espera a Google */
  syncItems(itemIds: (string | null | undefined)[]): void {
    const ids = itemIds.filter((id): id is string => !!id);
    if (ids.length && googleAvailable()) runInBackground('calendario', () => sync(ids));
  },

  syncList(listId: string): void {
    if (googleAvailable()) runInBackground('calendario', async () => sync(await itemIdsOfList(listId)));
  },

  /** Para las pruebas y el envío programado */
  sync,

  /**
   * Repaso de cada hora (junto con los recordatorios): borra eventos de tareas que ya no existen
   * y reintenta lo que haya fallado. Lo que no cambió no llama a Google.
   */
  async reconcile(): Promise<void> {
    if (!googleAvailable()) return;
    const { rows } = await db().query<{ id: string }>(
      `SELECT item_id AS id FROM calendar_events
       UNION SELECT w.id FROM (${WANTED_SELECT} AND i.due_date >= current_date - 7) w`,
    );
    await sync(rows.map((r) => r.id));
  },

  // ---------- Conexión ----------

  async status(userId: string) {
    const acc = await accountOf(userId);
    return { available: googleAvailable(), connected: !!acc, email: acc?.google_email ?? null, calendarName: CALENDAR_NAME };
  },

  /** Inicio de la conexión: URL de Google con un "state" firmado y un valor que queda en una cookie del navegador */
  async start(userId: string): Promise<{ url: string; nonce: string }> {
    if (!googleAvailable()) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED');
    const nonce = randomBytes(16).toString('base64url');
    const state = await new SignJWT({ nonce, purpose: 'google-calendar' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setExpirationTime(STATE_TTL)
      .sign(secretKey());
    return { url: google.authUrl(state), nonce };
  },

  /** Vuelta de Google: verifica que la empezó este navegador, guarda la cuenta y crea el calendario "Our House" */
  async finish(code: string, state: string, nonce: string | undefined): Promise<void> {
    let userId: string;
    try {
      const { payload } = await jwtVerify(state, secretKey(), { algorithms: ['HS256'] });
      if (payload['purpose'] !== 'google-calendar' || !nonce || payload['nonce'] !== nonce || typeof payload.sub !== 'string') throw new Error();
      userId = payload.sub;
    } catch {
      throw badRequest('GOOGLE_STATE_INVALID');
    }
    const tokens = await google.exchangeCode(code);
    if (!tokens.refresh_token) throw badRequest('GOOGLE_NO_REFRESH_TOKEN');
    const email = await google.userEmail(tokens.access_token);
    const { rows } = await db().query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw badRequest('GOOGLE_STATE_INVALID');

    // Reconectar la misma cuenta reutiliza su calendario
    const previous = await accountOf(userId);
    const calendarId =
      previous && previous.google_email === email ? previous.calendar_id : await google.createCalendar(tokens.access_token, CALENDAR_NAME, rows[0].timezone);
    if (previous && previous.calendar_id !== calendarId) await db().query('DELETE FROM calendar_events WHERE user_id = $1', [userId]);

    await db().query(
      `INSERT INTO google_accounts (user_id, google_email, refresh_token_enc, calendar_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET google_email = EXCLUDED.google_email, refresh_token_enc = EXCLUDED.refresh_token_enc,
         calendar_id = EXCLUDED.calendar_id, connected_at = now()`,
      [userId, email, seal(tokens.refresh_token), calendarId],
    );
    accessTokens.set(userId, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });

    // Las tareas con fecha que ya tenía (desde hace una semana en adelante) aparecen en el calendario
    runInBackground('calendario inicial', async () => {
      const { rows: items } = await db().query<{ id: string }>(`SELECT w.id FROM (${WANTED_SELECT} AND ga.user_id = $1 AND i.due_date >= current_date - 7) w`, [userId]);
      await sync(items.map((i) => i.id));
    });
  },

  /** Desconectar: quita el permiso en Google. El calendario "Our House" queda en la cuenta de la persona. */
  async disconnect(userId: string): Promise<void> {
    const acc = await accountOf(userId);
    if (!acc) return;
    await db().query('DELETE FROM google_accounts WHERE user_id = $1', [userId]);
    accessTokens.delete(userId);
    await google.revoke(open(acc.refresh_token_enc)).catch((err) => console.error('[calendario] revocar', err));
  },
};
