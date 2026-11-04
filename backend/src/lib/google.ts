import { env } from '../config/env.js';

/**
 * Cliente mínimo de Google (OAuth + Calendar) con fetch, sin SDK.
 * Permisos: correo de la cuenta y solo los calendarios que crea la app (calendar.app.created).
 */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'];

const CALENDAR = 'https://www.googleapis.com/calendar/v3';

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Google ${status}: ${body.slice(0, 300)}`);
  }
  /** El permiso fue revocado o venció: hay que volver a conectar */
  get revoked(): boolean {
    return this.status === 400 && this.body.includes('invalid_grant');
  }
}

export const googleAvailable = () => !!env.google.clientId && !!env.google.clientSecret;
export const redirectUri = () => `${env.appUrl}/api/google/callback`;

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new GoogleError(res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});

export interface CalendarEvent {
  summary: string;
  description: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
}

export const google = {
  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env.google.clientId!,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      // offline + consent: Google entrega el refresh token para sincronizar sin la persona presente
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  exchangeCode: (code: string) =>
    call<{ access_token: string; refresh_token?: string; id_token?: string; expires_in: number }>(
      'https://oauth2.googleapis.com/token',
      form({ code, client_id: env.google.clientId!, client_secret: env.google.clientSecret!, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
    ),

  refresh: (refreshToken: string) =>
    call<{ access_token: string; expires_in: number }>(
      'https://oauth2.googleapis.com/token',
      form({ refresh_token: refreshToken, client_id: env.google.clientId!, client_secret: env.google.clientSecret!, grant_type: 'refresh_token' }),
    ),

  revoke: (token: string) => call<void>('https://oauth2.googleapis.com/revoke', form({ token })),

  userEmail: async (accessToken: string) =>
    (await call<{ email: string }>('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })).email,

  createCalendar: async (accessToken: string, summary: string, timeZone: string) =>
    (
      await call<{ id: string }>(`${CALENDAR}/calendars`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, timeZone }),
      })
    ).id,

  insertEvent: async (accessToken: string, calendarId: string, event: CalendarEvent) =>
    (
      await call<{ id: string }>(`${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })
    ).id,

  updateEvent: (accessToken: string, calendarId: string, eventId: string, event: CalendarEvent) =>
    call<unknown>(`${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }),

  deleteEvent: (accessToken: string, calendarId: string, eventId: string) =>
    call<void>(`${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
};
