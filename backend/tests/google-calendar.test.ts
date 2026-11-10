import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { db } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { settleBackground } from '../src/lib/background.js';
import { open, seal } from '../src/lib/secret-box.js';
import { calendarService } from '../src/services/calendar.service.js';
import { createList, resetDb, setupFamily, type User } from './helpers.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Google simulado: responde a OAuth y Calendar y anota cada llamada */
function fakeGoogle() {
  const calls: Call[] = [];
  let nextEvent = 1;
  const events = new Map<string, Record<string, unknown>>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const raw = typeof init.body === 'string' ? init.body : '';
      const body = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method, url, body });
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.endsWith('/token')) {
        if (body.grant_type === 'authorization_code') return json({ access_token: 'at-1', refresh_token: 'rt-secreto', expires_in: 3600 });
        return json({ access_token: 'at-2', expires_in: 3600 });
      }
      if (url.includes('/userinfo')) return json({ email: 'ana@gmail.com' });
      if (url.endsWith('/calendars') && method === 'POST') return json({ id: 'cal-our-house' });
      if (url.endsWith('/revoke')) return new Response('', { status: 200 });
      const m = url.match(/\/events(?:\/([^/?]+))?$/);
      if (m) {
        if (method === 'POST') {
          const id = `ev-${nextEvent++}`;
          events.set(id, body);
          return json({ id });
        }
        if (method === 'PUT') {
          if (!events.has(m[1]!)) return new Response('{"error":"gone"}', { status: 410 });
          events.set(m[1]!, body);
          return json({ id: m[1] });
        }
        if (method === 'DELETE') {
          events.delete(m[1]!);
          return new Response('', { status: 204 });
        }
      }
      return new Response('no simulado', { status: 500 });
    }),
  );
  return { calls, events };
}

/** Conecta la cuenta de Google de una persona recorriendo el flujo completo */
async function connect(user: User) {
  const start = await user.agent.post('/api/google/connect').expect(200);
  const url = new URL(start.body.url);
  expect(url.hostname).toBe('accounts.google.com');
  expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.app.created');
  expect(url.searchParams.get('access_type')).toBe('offline');
  const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('oh_gstate='))!;
  expect(cookie).toContain('SameSite=Lax');
  // Google vuelve con un navegador sin la cookie de sesión (Strict), solo con la del state
  const back = await request(app)
    .get(`/api/google/callback?code=codigo&state=${url.searchParams.get('state')}`)
    .set('Cookie', cookie.split(';')[0]!)
    .expect(302);
  expect(back.headers.location).toBe(`${env.appUrl}/perfil?google=connected#calendario`);
  await settleBackground();
}

describe('Google Calendar', () => {
  beforeEach(async () => {
    await resetDb();
    vi.spyOn(env.google, 'clientId', 'get').mockReturnValue('client-id');
    vi.spyOn(env.google, 'clientSecret', 'get').mockReturnValue('client-secret');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('el token queda cifrado', () => {
    const sealed = seal('rt-secreto');
    expect(sealed).not.toContain('rt-secreto');
    expect(open(sealed)).toBe('rt-secreto');
  });

  it('conecta, crea el calendario "Our House" y guarda el token cifrado', async () => {
    const g = fakeGoogle();
    const { users } = await setupFamily(['ana']);
    await connect(users.ana!);
    const status = (await users.ana!.agent.get('/api/google/status').expect(200)).body;
    expect(status).toEqual({ available: true, connected: true, email: 'ana@gmail.com', calendarName: 'Our House' });
    expect(g.calls.find((c) => c.url.endsWith('/calendars'))!.body).toMatchObject({ summary: 'Our House' });
    const { rows } = await db().query('SELECT refresh_token_enc FROM google_accounts');
    expect(rows[0].refresh_token_enc).not.toContain('rt-secreto');
  });

  it('rechaza una vuelta de Google que no empezó este navegador', async () => {
    fakeGoogle();
    const { users } = await setupFamily(['ana']);
    const start = await users.ana!.agent.post('/api/google/connect').expect(200);
    const state = new URL(start.body.url).searchParams.get('state');
    const back = await request(app).get(`/api/google/callback?code=x&state=${state}`).expect(302);
    expect(back.headers.location).toContain('google=error');
    expect((await db().query('SELECT count(*)::int AS n FROM google_accounts')).rows[0].n).toBe(0);
  });

  it('la tarea con fecha va al calendario de su responsable, con ✓ al completarse y sin evento al quitar la fecha', async () => {
    const g = fakeGoogle();
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await connect(users.ana!);
    const list = await createList(users.beto!, familyId, { name: 'Casa', type: 'todo' });
    const ana = users.ana!.user.id;

    const item = (await users.beto!.agent
      .post(`/api/lists/${list.id}/items`)
      .send({ text: 'Pagar luz', description: 'Factura en el cajón', assigneeId: ana, dueDate: '2026-11-20', dueTime: '18:30' })
      .expect(201)).body.item;
    await settleBackground();
    const [eventId, event] = [...g.events.entries()][0]!;
    expect(event).toMatchObject({ summary: 'Pagar luz', start: { dateTime: item.dueAt }, reminders: { overrides: [{ minutes: 30 }] } });
    expect(String(event['description'])).toMatch(/^Factura en el cajón\n\nCasa\n/);

    await users.beto!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: true }).expect(200);
    await settleBackground();
    expect(g.events.get(eventId)).toMatchObject({ summary: '✓ Pagar luz' });

    // Sin cambios no se llama a Google
    const before = g.calls.length;
    await calendarService.sync([item.id]);
    expect(g.calls.length).toBe(before);

    await users.beto!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ dueDate: null }).expect(200);
    await settleBackground();
    expect(g.events.size).toBe(0);
  });

  it('sin responsable va al calendario de quien la creó; borrar la tarea borra el evento', async () => {
    const g = fakeGoogle();
    const { familyId, users } = await setupFamily(['ana']);
    await connect(users.ana!);
    const list = await createList(users.ana!, familyId, { type: 'todo' });
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Día libre', dueDate: '2026-11-25' }).expect(201)).body.item;
    await settleBackground();
    expect([...g.events.values()][0]).toMatchObject({ start: { date: '2026-11-25' }, end: { date: '2026-11-26' } });

    await users.ana!.agent.delete(`/api/lists/${list.id}/items/${item.id}`).expect(204);
    await settleBackground();
    expect(g.events.size).toBe(0);
  });

  it('si la persona borró el evento en Google, se vuelve a crear', async () => {
    const g = fakeGoogle();
    const { familyId, users } = await setupFamily(['ana']);
    await connect(users.ana!);
    const list = await createList(users.ana!, familyId, { type: 'todo' });
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'X', dueDate: '2026-11-25' }).expect(201)).body.item;
    await settleBackground();
    g.events.clear();
    await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ text: 'Y' }).expect(200);
    await settleBackground();
    expect([...g.events.values()].map((e) => e['summary'])).toEqual(['Y']);
  });

  it('desconectar quita el permiso en Google', async () => {
    const g = fakeGoogle();
    const { users } = await setupFamily(['ana']);
    await connect(users.ana!);
    await users.ana!.agent.delete('/api/google').expect(204);
    expect(g.calls.at(-1)).toMatchObject({ url: 'https://oauth2.googleapis.com/revoke', body: { token: 'rt-secreto' } });
    expect((await users.ana!.agent.get('/api/google/status')).body.connected).toBe(false);
  });

  it('sin GOOGLE_CLIENT_ID la opción no está disponible', async () => {
    vi.spyOn(env.google, 'clientId', 'get').mockReturnValue(undefined);
    const { users } = await setupFamily(['ana']);
    expect((await users.ana!.agent.get('/api/google/status')).body).toMatchObject({ available: false, connected: false });
    await users.ana!.agent.post('/api/google/connect').expect(503, { error: 'GOOGLE_NOT_CONFIGURED' });
  });
});
