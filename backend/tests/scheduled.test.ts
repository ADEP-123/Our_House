import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleBackground } from '../src/lib/background.js';
import { addDays, todayIn } from '../src/lib/recurrence.js';
import { scheduledService } from '../src/services/scheduled.service.js';
import { resetDb, setupFamily, type User } from './helpers.js';

type Mail = { sent: { to: string; content: { subject: string; text: string } }[] };
type Body = Record<string, unknown>;

/** Mismo día del mes, n meses antes o después (como lo calcula la repetición mensual) */
function shiftMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
const at = (date: string) => new Date(`${date}T12:00:00Z`);

describe('movimientos programados', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto']);
    const cats = Object.fromEntries(
      ((await users.ana!.agent.get(`/api/families/${familyId}/categories`)).body.categories as { id: string; name: string }[]).map((c) => [c.name, c.id]),
    );
    const account = async (body: Body) =>
      (await users.ana!.agent.post(`/api/families/${familyId}/accounts`).send({ kind: 'bank', ...body }).expect(201)).body.account as { id: string };
    const nu = await account({ name: 'Nu', prefix: 'T', opening: { amount: 1000, date: '2026-01-01' } });
    const visa = await account({ name: 'Visa', prefix: 'V', kind: 'credit', creditLimit: 100 });
    const today = todayIn('UTC');
    const create = (user: User, body: Body) =>
      user.agent
        .post(`/api/families/${familyId}/scheduled`)
        .send({ accountId: nu.id, kind: 'out', amount: 15.99, description: 'Netflix', categoryId: cats['Ocio'], rule: { freq: 'monthly', start: today }, ...body });
    const list = async (user: User = users.ana!) => (await user.agent.get(`/api/families/${familyId}/scheduled`).expect(200)).body;
    const movements = async (accountId = nu.id) =>
      ((await users.ana!.agent.get(`/api/accounts/${accountId}/movements`)).body.movements as { description: string; amount: number; date: string; scheduled: boolean; kind: string }[]).filter(
        (m) => m.kind !== 'opening',
      );
    return { familyId, users, mail: mail as Mail, cats, nu, visa, today, create, list, movements };
  }

  async function mailsDuring(mail: Mail, action: () => Promise<unknown>) {
    const before = mail.sent.length;
    await action();
    await settleBackground();
    return mail.sent.slice(before).map((m) => `${m.to} | ${m.content.subject}`);
  }

  it('automático: lo de hoy se registra al crearlo y sigue el mes siguiente; lo pasado se pone al día', async () => {
    const { users, create, list, movements, today } = await setup();
    const { id } = (await create(users.ana!, {}).expect(201)).body;
    let rows = await movements();
    expect(rows.map((m) => [m.description, m.amount, m.date, m.scheduled])).toEqual([['Netflix', 15.99, today, true]]);
    const item = (await list()).items[0];
    expect(item).toMatchObject({ id, nextDate: shiftMonths(today, 1), timesDone: 1, paused: null, ended: false, canManage: true });

    // Desde hace dos meses ("registrar también los anteriores"): tres registros
    await create(users.ana!, { description: 'Gimnasio', rule: { freq: 'monthly', start: shiftMonths(today, -2) } }).expect(201);
    rows = await movements();
    expect(rows.filter((m) => m.description === 'Gimnasio').map((m) => m.date)).toEqual([shiftMonths(today, -2), shiftMonths(today, -1), today]);
  });

  it('proceso horario: registra el día que toca (una sola vez), avisa antes y al registrarse', async () => {
    const { users, mail, create, movements, today } = await setup();
    const start = addDays(today, 3);
    await create(users.ana!, { rule: { freq: 'monthly', start }, remindDays: 2 }).expect(201);
    expect(await movements()).toEqual([]);

    expect(await mailsDuring(mail, () => scheduledService.run(at(addDays(today, 1))))).toHaveLength(1); // 2 días antes
    expect(await mailsDuring(mail, () => scheduledService.run(at(addDays(today, 1))))).toEqual([]);
    const done = await mailsDuring(mail, () => scheduledService.run(at(start)));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatch(/^ana@test\.com \| Registrado: Netflix \(15,99\sUS\$\)$/);
    await scheduledService.run(at(start));
    expect((await movements()).map((m) => m.date)).toEqual([start]);
  });

  it('a confirmar: queda pendiente; se confirma con el monto real o se descarta', async () => {
    const { users, mail, create, list, movements, today } = await setup();
    const sent = await mailsDuring(mail, () =>
      create(users.ana!, { description: 'Luz', amount: 40, mode: 'confirm', rule: { freq: 'monthly', start: shiftMonths(today, -1) } }).expect(201),
    );
    expect(sent).toEqual([
      'ana@test.com | Confirma el monto de Luz',
      'ana@test.com | Confirma el monto de Luz',
    ]);
    const { pending } = await list();
    expect(pending.map((p: { dueDate: string; amount: number }) => [p.dueDate, p.amount])).toEqual([
      [shiftMonths(today, -1), 40],
      [today, 40],
    ]);
    expect(await movements()).toEqual([]);
    await users.ana!.agent.post(`/api/scheduled/occurrences/${pending[0].id}/confirm`).send({ amount: 42.5 }).expect(200);
    await users.ana!.agent.post(`/api/scheduled/occurrences/${pending[1].id}/dismiss`).expect(200);
    expect((await movements()).map((m) => [m.amount, m.date, m.scheduled])).toEqual([[42.5, shiftMonths(today, -1), true]]);
    expect((await list()).pending).toEqual([]);
    await users.ana!.agent.post(`/api/scheduled/occurrences/${pending[1].id}/confirm`).send({ amount: 1 }).expect(404);
  });

  it('transferencias y apartados para un proyecto; si no alcanza el disponible, esa vez falla y avisa', async () => {
    const { familyId, users, mail, create, nu, visa, movements, today } = await setup();
    await create(users.ana!, { kind: 'transfer', toAccountId: visa.id, categoryId: null, amount: 50, description: 'Pago Visa' }).expect(201);
    expect((await movements(visa.id)).map((m) => [m.kind, m.amount, m.scheduled])).toEqual([['transfer_in', 50, true]]);

    const project = (await users.ana!.agent.post(`/api/families/${familyId}/savings`).send({ name: 'Viaje', icon: '✈️' }).expect(201)).body.id;
    await create(users.ana!, { kind: 'set_aside', savingsProjectId: project, categoryId: null, amount: 100, description: 'Ahorro viaje' }).expect(201);
    expect((await users.ana!.agent.get(`/api/accounts/${nu.id}`)).body.account.savings.total).toBe(100);

    const sent = await mailsDuring(mail, () =>
      create(users.ana!, { kind: 'set_aside', savingsProjectId: project, categoryId: null, amount: 5000, description: 'Ahorro grande' }).expect(201),
    );
    expect(sent).toEqual(['ana@test.com | No se pudo registrar Ahorro grande']);
    const item = (await users.ana!.agent.get(`/api/families/${familyId}/scheduled`)).body.items.find((i: { description: string }) => i.description === 'Ahorro grande');
    expect(item).toMatchObject({ paused: null, nextDate: shiftMonths(today, 1) });
  });

  it('saltar, pausar, reanudar y terminar después de N veces', async () => {
    const { users, create, list, movements, today } = await setup();
    const { id } = (await create(users.ana!, { rule: { freq: 'monthly', start: addDays(today, 1), count: 2 } }).expect(201)).body;
    await users.ana!.agent.post(`/api/scheduled/${id}/skip`).expect(200);
    expect((await list()).items[0].nextDate).toBe(shiftMonths(addDays(today, 1), 1));

    await users.ana!.agent.post(`/api/scheduled/${id}/pause`).expect(200);
    await scheduledService.run(at(shiftMonths(addDays(today, 1), 1)));
    expect(await movements()).toEqual([]);
    expect((await list()).items[0].paused).toEqual({ reason: 'manual' });

    await users.ana!.agent.post(`/api/scheduled/${id}/resume`).expect(200);
    const next = (await list()).items[0].nextDate;
    expect(next >= today).toBe(true);
    await scheduledService.run(at(next));
    await scheduledService.run(at(shiftMonths(next, 1)));
    await scheduledService.run(at(shiftMonths(next, 2)));
    expect((await movements()).map((m) => m.date)).toEqual([next, shiftMonths(next, 1)]);
    expect((await list()).items[0]).toMatchObject({ ended: true, nextDate: null, timesDone: 2 });
  });

  it('permisos: solo quien edita la cuenta; si la archivan se pausa y avisa', async () => {
    const { users, mail, create, list, nu, today } = await setup();
    const account = (await users.ana!.agent.get(`/api/accounts/${nu.id}`)).body.account;
    await users.ana!.agent
      .put(`/api/accounts/${nu.id}`)
      .send({ name: 'Nu', kind: 'bank', prefix: 'T', opening: { amount: account.opening.amount, date: account.opening.date }, editRoles: ['leader'] })
      .expect(200);
    expect((await create(users.beto!, {}).expect(403)).body.error).toBe('ACCOUNT_READ_ONLY');

    const { id } = (await create(users.ana!, { rule: { freq: 'monthly', start: addDays(today, 1) } }).expect(201)).body;
    expect((await list(users.beto!)).items[0]).toMatchObject({ id, canManage: false });
    expect((await users.beto!.agent.post(`/api/scheduled/${id}/pause`).expect(403)).body.error).toBe('SCHEDULED_READ_ONLY');

    await users.ana!.agent.post(`/api/accounts/${nu.id}/archive`).expect(200);
    const sent = await mailsDuring(mail, () => scheduledService.run(at(addDays(today, 1))));
    expect(sent).toEqual(['ana@test.com | No se pudo registrar Netflix']);
    expect((await list()).items[0]).toMatchObject({ paused: { reason: 'archived' }, nextDate: addDays(today, 1) });
  });

  it('próximos cobros y cambiar un programado', async () => {
    const { familyId, users, create, today } = await setup();
    const { id } = (await create(users.ana!, { rule: { freq: 'monthly', start: addDays(today, 1) } }).expect(201)).body;
    await create(users.ana!, { description: 'Bus', amount: 2, rule: { freq: 'weekly', start: addDays(today, 1) } }).expect(201);
    const to = addDays(today, 15);
    const upcoming = (await users.ana!.agent.get(`/api/families/${familyId}/scheduled/upcoming?to=${to}`).expect(200)).body.items;
    expect(upcoming.filter((u: { description: string }) => u.description === 'Bus').map((u: { date: string }) => u.date)).toEqual([
      addDays(today, 1),
      addDays(today, 8),
      addDays(today, 15),
    ]);
    expect(upcoming.filter((u: { description: string }) => u.description === 'Netflix')).toHaveLength(1);

    const accountId = (await users.ana!.agent.get(`/api/families/${familyId}/accounts`)).body.accounts[0].id;
    const categoryId = await categoryOf(users.ana!, familyId);
    await users.ana!.agent
      .put(`/api/scheduled/${id}`)
      .send({ accountId, kind: 'out', amount: 19.99, description: 'Netflix 4K', categoryId, rule: { freq: 'monthly', start: addDays(today, 5) } })
      .expect(200);
    const item = (await users.ana!.agent.get(`/api/families/${familyId}/scheduled`)).body.items.find((i: { id: string }) => i.id === id);
    expect(item).toMatchObject({ amount: 19.99, description: 'Netflix 4K', nextDate: addDays(today, 5) });
    await users.ana!.agent.delete(`/api/scheduled/${id}`).expect(204);
  });

  it('sugerencias: gastos repetidos en 3 meses que aún no están programados', async () => {
    const { familyId, users, cats, nu, create, today } = await setup();
    for (const n of [-3, -2, -1]) {
      await users.ana!.agent
        .post(`/api/accounts/${nu.id}/movements`)
        .send({ kind: 'out', amount: 30, date: shiftMonths(today, n), description: 'Gimnasio', categoryId: cats['Deporte'] })
        .expect(201);
    }
    const before = (await users.ana!.agent.get(`/api/families/${familyId}/scheduled/suggestions`).expect(200)).body.suggestions;
    expect(before).toEqual([
      { accountId: nu.id, accountName: 'Nu', description: 'Gimnasio', categoryId: cats['Deporte'], amount: 30, day: Number(shiftMonths(today, -1).slice(8)), months: 3 },
    ]);
    await create(users.ana!, { description: 'gimnasio', rule: { freq: 'monthly', start: addDays(today, 1) } }).expect(201);
    expect((await users.ana!.agent.get(`/api/families/${familyId}/scheduled/suggestions`)).body.suggestions).toEqual([]);
  });
});

async function categoryOf(user: User, familyId: string) {
  return ((await user.agent.get(`/api/families/${familyId}/categories`)).body.categories as { id: string; name: string }[]).find((c) => c.name === 'Ocio')!.id;
}
