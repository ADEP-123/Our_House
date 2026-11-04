import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { localParts, remindersService, shouldRemind } from '../src/services/reminders.service.js';
import { api, createList, resetDb, setupFamily } from './helpers.js';

const LA = 'America/Los_Angeles';
/** Momento en Los Ángeles (UTC-8 en noviembre) */
const laTime = (date: string, hour: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (hour + 8) * 3_600_000);

describe('cálculo de recordatorios', () => {
  const base = { due_at: null, start_days: 3, every_days: 1, timezone: LA, reminder_hour: 8 };

  it('desde 3 días antes, cada día, a la hora elegida y siempre el día límite', () => {
    const at = (date: string, hour = 9) => shouldRemind({ ...base, due_date: '2026-11-20' }, laTime(date, hour));
    expect(at('2026-11-16')).toBeNull(); // 4 días antes
    expect(at('2026-11-17')).toMatchObject({ daysLeft: 3, localDate: '2026-11-17' });
    expect(at('2026-11-19')).toMatchObject({ daysLeft: 1 });
    expect(at('2026-11-20')).toMatchObject({ daysLeft: 0 });
    expect(at('2026-11-21')).toBeNull(); // ya venció
    expect(at('2026-11-18', 7)).toBeNull(); // antes de las 8
  });

  it('cada 2 días cuenta desde el primer día y termina en la fecha límite', () => {
    const days = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
    const sent = days.filter((d) => shouldRemind({ ...base, due_date: '2026-11-20', start_days: 5, every_days: 2 }, laTime(d, 9)));
    expect(sent).toEqual(['2026-11-15', '2026-11-17', '2026-11-19', '2026-11-20']);
  });

  it('si vence temprano el día límite, avisa 2 horas antes; si ya pasó la hora, no', () => {
    const c = { ...base, due_date: '2026-11-20', due_at: laTime('2026-11-20', 7) };
    expect(shouldRemind(c, laTime('2026-11-20', 4))).toBeNull();
    expect(shouldRemind(c, laTime('2026-11-20', 5))).toMatchObject({ daysLeft: 0 });
    expect(shouldRemind(c, laTime('2026-11-20', 7))).toBeNull();
  });

  it('usa la fecha local de la persona', () => {
    expect(localParts(new Date('2026-11-21T03:00:00Z'), LA)).toEqual({ date: '2026-11-20', hour: 19 });
  });
});

describe('envío de recordatorios', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('envía una vez por día al responsable y no a tareas hechas, sin fecha o apagadas', async () => {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto']);
    await users.beto!.agent.patch('/api/me').send({ timezone: LA }).expect(200);
    const list = await createList(users.ana!, familyId, { name: 'Casa', type: 'todo' });
    const add = (body: Record<string, unknown>) => users.ana!.agent.post(`/api/lists/${list.id}/items`).send(body).expect(201);
    const beto = users.beto!.user.id;
    await add({ text: 'Pagar luz', assigneeId: beto, dueDate: '2026-11-20' });
    await add({ text: 'Apagada', assigneeId: beto, dueDate: '2026-11-20', remindersOff: true });
    await add({ text: 'Sin fecha', assigneeId: beto });
    const hecha = (await add({ text: 'Hecha', assigneeId: beto, dueDate: '2026-11-20' })).body.item;
    await users.beto!.agent.put(`/api/lists/${list.id}/items/${hecha.id}/completed`).send({ completed: true }).expect(200);

    const before = mail.sent.length;
    expect(await remindersService.run(laTime('2026-11-19', 9))).toEqual({ sent: 1 });
    expect(await remindersService.run(laTime('2026-11-19', 10))).toEqual({ sent: 0 });
    const sent = mail.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'beto@test.com', content: { subject: 'Recordatorio: «Pagar luz» vence mañana' } });
  });

  it('cada tarea puede cambiar desde cuándo y cada cuánto; sin responsable, recibe quien la creó', async () => {
    const { familyId, users, mail } = await setupFamily(['ana']);
    await users.ana!.agent.patch('/api/me').send({ timezone: LA }).expect(200);
    await users.ana!.agent.patch('/api/me/settings').send({ reminderHour: 20 }).expect(200);
    const list = await createList(users.ana!, familyId, { type: 'todo' });
    await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Renovar pasaporte', dueDate: '2026-11-30', reminderStartDays: 10, reminderEveryDays: 5 }).expect(201);

    const before = mail.sent.length;
    expect(await remindersService.run(laTime('2026-11-20', 9))).toEqual({ sent: 0 }); // antes de las 20
    expect(await remindersService.run(laTime('2026-11-20', 20))).toEqual({ sent: 1 });
    expect(await remindersService.run(laTime('2026-11-21', 21))).toEqual({ sent: 0 }); // no toca (cada 5)
    expect(mail.sent.slice(before)[0]!.content.subject).toBe('Recordatorio: «Renovar pasaporte» vence en 10 días');

    await users.ana!.agent.patch('/api/me/settings').send({ reminders: false }).expect(200);
    expect(await remindersService.run(laTime('2026-11-25', 21))).toEqual({ sent: 0 });
  });

  it('el endpoint exige CRON_SECRET', async () => {
    vi.spyOn(env, 'cronSecret', 'get').mockReturnValue(undefined);
    await api().post('/api/cron/reminders').expect(503, { error: 'CRON_DISABLED' });
  });
});
