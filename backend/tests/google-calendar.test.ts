import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { db } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { settleBackground } from '../src/lib/background.js';
import { open, seal } from '../src/lib/secret-box.js';
import { calendarService } from '../src/services/calendar.service.js';
import { connect, fakeGoogle } from './google-fake.js';
import { createList, resetDb, setupFamily } from './helpers.js';

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

  it('una tarea que se repite deja el evento de esta vez como ✓ y crea el de la siguiente fecha', async () => {
    const g = fakeGoogle();
    const { familyId, users } = await setupFamily(['ana']);
    await connect(users.ana!);
    const list = await createList(users.ana!, familyId, { type: 'todo' });
    const body = { text: 'Regar plantas', dueDate: '2030-03-04', repeat: { freq: 'weekly' } };
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send(body).expect(201)).body.item;
    await settleBackground();
    const [firstId] = [...g.events.keys()];

    const after = (await users.ana!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: true }).expect(200)).body.item;
    await settleBackground();
    expect(after).toMatchObject({ dueDate: '2030-03-11', completedAt: null });
    expect(g.events.size).toBe(2);
    expect(g.events.get(firstId!)).toMatchObject({ summary: '✓ Regar plantas', start: { date: '2030-03-04' } });
    const next = [...g.events.entries()].find(([id]) => id !== firstId)![1];
    expect(next).toMatchObject({ summary: 'Regar plantas', start: { date: '2030-03-11' } });
    expect((await db().query('SELECT event_id FROM calendar_events')).rows.map((r) => r.event_id)).not.toContain(firstId);
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
