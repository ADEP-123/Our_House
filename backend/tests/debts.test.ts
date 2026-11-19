import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { cardMonths, debtBalance, installmentInfo, lastMonths } from '../src/lib/debts.js';
import { todayIn } from '../src/lib/recurrence.js';
import { debtsService } from '../src/services/debts.service.js';
import { resetDb, setupFamily } from './helpers.js';

const LA = 'America/Los_Angeles';
const laTime = (date: string, hour: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (hour + 8) * 3_600_000);

describe('cálculos de deudas', () => {
  it('saldo, cuotas y meses', () => {
    const entries = [
      { kind: 'payment' as const, amount: 250, date: '2026-10-05' },
      { kind: 'increase' as const, amount: 20, date: '2026-10-30' },
      { kind: 'decrease' as const, amount: 10, date: '2026-11-02' },
    ];
    expect(debtBalance(1000, entries)).toBe(760);
    expect(debtBalance(1000, entries, '2026-10-31')).toBe(770);
    expect(debtBalance(100, [{ kind: 'payment', amount: 150, date: '2026-01-01' }])).toBe(0);
    expect(installmentInfo(1000, 4, 250)).toEqual({ each: 250, paid: 1, total: 4 });
    expect(installmentInfo(1000, 3, 1000)).toEqual({ each: 333.33, paid: 3, total: 3 });
    expect(installmentInfo(1000, null, 0)).toBeNull();
    const months = lastMonths('2026-11-17', 3);
    expect(months).toEqual([
      { month: '2026-09', end: '2026-09-30' },
      { month: '2026-10', end: '2026-10-31' },
      { month: '2026-11', end: '2026-11-17' },
    ]);
    const card = [
      { date: '2026-09-10', kind: 'out', amount: 100 },
      { date: '2026-10-03', kind: 'transfer_in', amount: 60 },
      { date: '2026-10-20', kind: 'out', amount: 30 },
    ];
    expect(cardMonths(card, months)).toEqual([
      { month: '2026-09', purchases: 100, payments: 0, debt: 100 },
      { month: '2026-10', purchases: 30, payments: 60, debt: 70 },
      { month: '2026-11', purchases: 0, payments: 0, debt: 70 },
    ]);
  });
});

/** Ana (líder), Beto (miembro) y Carla (supervisada) */
async function setup() {
  const { familyId, users, mail } = await setupFamily(['ana', 'beto', 'carla'], ['carla']);
  for (const u of Object.values(users)) await u.agent.patch('/api/me').send({ timezone: LA }).expect(200);
  const { ana, beto, carla } = users as Required<typeof users>;
  const newDebt = (u = ana, body: Record<string, unknown> = {}) =>
    u.agent
      .post(`/api/families/${familyId}/debts`)
      .send({ direction: 'owe', title: 'Préstamo carro', counterparty: 'Banco Popular', amount: 1000, ...body })
      .then((r) => r.body.id as string);
  const list = (u = ana) => u.agent.get(`/api/families/${familyId}/debts`).expect(200).then((r) => r.body);
  const entry = (u: typeof ana, id: string, body: Record<string, unknown>) => u.agent.post(`/api/debts/${id}/entries`).send({ date: '2026-11-10', ...body });
  return { familyId, ana, beto, carla, mail, newDebt, list, entry };
}

describe('deudas', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('crea, abona, suma interés y cuenta las cuotas; no deja abonar más de lo que se debe', async () => {
    const { ana, beto, newDebt, list, entry } = await setup();
    const id = await newDebt(ana, { installments: 4, interestRate: 2, dueDate: '2026-12-01', description: 'Cuota mensual' });
    await entry(ana, id, { kind: 'payment', amount: 250, note: 'Cuota 1' }).expect(201);
    // Beto (miembro) también registra
    await entry(beto, id, { kind: 'increase', amount: 15, note: 'Interés' }).expect(201);
    const tooMuch = await entry(ana, id, { kind: 'payment', amount: 5000 }).expect(400);
    expect(tooMuch.body).toEqual({ error: 'DEBT_AMOUNT_TOO_MUCH', balance: 765 });

    const d = (await list()).debts[0];
    expect(d).toMatchObject({
      direction: 'owe',
      title: 'Préstamo carro',
      counterparty: 'Banco Popular',
      amount: 1000,
      balance: 765,
      paid: 250,
      total: 1015,
      dueDate: '2026-12-01',
      installments: { each: 250, paid: 1, total: 4 },
      interest: { rate: 2, period: 'monthly' },
      permissions: { canEdit: true, canAdmin: true, supervision: false },
    });
    const forBeto = (await list(beto)).debts[0];
    expect(forBeto.permissions).toEqual({ canEdit: true, canAdmin: false, supervision: false });
    // Solo quien la creó cambia sus datos o la borra
    await beto.agent.put(`/api/debts/${id}`).send({ direction: 'owe', title: 'X', counterparty: 'Y', amount: 5 }).expect(403, { error: 'DEBT_ADMIN_ONLY' });
    await beto.agent.delete(`/api/debts/${id}`).expect(403);

    const history = (await ana.agent.get(`/api/debts/${id}/history`).expect(200)).body.history;
    expect(history.map((h: { kind: string; by: { nickname: string } }) => `${h.kind}:${h.by.nickname}`)).toEqual(['increase:beto', 'payment:ana', 'created:ana']);
  });

  it('un abono puede registrar su movimiento en una cuenta; quitar el abono lo borra', async () => {
    const { ana, familyId, newDebt, entry } = await setup();
    const category = (await ana.agent.get(`/api/families/${familyId}/categories`)).body.categories[0].id;
    const bank = (
      await ana.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Banco', kind: 'bank', prefix: 'B', opening: { amount: 2000, date: '2026-10-01' } })
    ).body.account;
    const owe = await newDebt();
    const owed = await newDebt(ana, { direction: 'owed', title: 'Préstamo a Luis', counterparty: 'Luis', amount: 300 });

    const paid = (await entry(ana, owe, { kind: 'payment', amount: 200, accountId: bank.id, categoryId: category }).expect(201)).body.id;
    await entry(ana, owed, { kind: 'payment', amount: 100, accountId: bank.id, categoryId: category }).expect(201);
    await entry(ana, owe, { kind: 'payment', amount: 10, accountId: bank.id }).expect(400, { error: 'CATEGORY_NOT_FOUND' });

    const movements = (await ana.agent.get(`/api/accounts/${bank.id}/movements`)).body.movements;
    expect(movements.filter((m: { kind: string }) => m.kind !== 'opening').map((m: { kind: string; amount: number; description: string }) => `${m.kind} ${m.amount} ${m.description}`).sort()).toEqual([
      'in 100 Préstamo a Luis · Luis',
      'out 200 Préstamo carro · Banco Popular',
    ]);
    const history = (await ana.agent.get(`/api/debts/${owe}/history`)).body.history;
    expect(history[0].movement).toMatchObject({ accountName: 'Banco', code: 'B0002' });

    await ana.agent.delete(`/api/debts/entries/${paid}`).expect(204);
    const after = (await ana.agent.get(`/api/accounts/${bank.id}`)).body.account;
    expect(after.balance).toBe(2100);
  });

  it('quién ve cada deuda: grupo, elegidos, privada; los líderes leen las privadas de los supervisados', async () => {
    const { ana, beto, carla, newDebt, list, entry } = await setup();
    await newDebt(ana, { title: 'Del grupo' });
    await newDebt(ana, { title: 'Para Carla', viewMode: 'members', viewers: [carla.user.id] });
    await newDebt(beto, { title: 'Privada de Beto', viewMode: 'private' });
    const carlas = await newDebt(carla, { title: 'Privada de Carla', viewMode: 'private' });

    const titles = async (u: typeof ana) => (await list(u)).debts.map((d: { title: string }) => d.title).sort();
    expect(await titles(ana)).toEqual(['Del grupo', 'Para Carla', 'Privada de Carla']);
    expect(await titles(beto)).toEqual(['Del grupo', 'Privada de Beto']);
    expect(await titles(carla)).toEqual(['Del grupo', 'Para Carla', 'Privada de Carla']);

    const seen = (await list(ana)).debts.find((d: { title: string }) => d.title === 'Privada de Carla');
    expect(seen.permissions).toEqual({ canEdit: false, canAdmin: false, supervision: true });
    await entry(ana, carlas, { kind: 'payment', amount: 10 }).expect(403, { error: 'DEBT_READ_ONLY' });
    // Carla (supervisada) ve la del grupo pero no registra en ella
    const group = (await list(carla)).debts.find((d: { title: string }) => d.title === 'Del grupo');
    expect(group.permissions.canEdit).toBe(false);
    await beto.agent.get(`/api/debts/${carlas}/history`).expect(404);
  });

  it('las tarjetas de crédito aparecen con su deuda de cada mes; totales y línea de tiempo', async () => {
    const { ana, familyId, newDebt, list, entry } = await setup();
    const category = (await ana.agent.get(`/api/families/${familyId}/categories`)).body.categories[0].id;
    const visa = (
      await ana.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 900, opening: { amount: -100, date: '2026-01-01' } })
    ).body.account;
    await ana.agent.post(`/api/accounts/${visa.id}/movements`).send({ kind: 'out', amount: 50, date: '2026-01-10', description: 'Compra', categoryId: category }).expect(201);
    const id = await newDebt(ana, { amount: 400 });
    await entry(ana, id, { kind: 'payment', amount: 100 }).expect(201);
    await newDebt(ana, { direction: 'owed', title: 'Luis', counterparty: 'Luis', amount: 80 });

    const data = await list();
    expect(data.totals).toEqual({ owe: 300, owed: 80, cards: 150 });
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0]).toMatchObject({ name: 'Visa', debt: 150, limit: 900 });
    expect(data.cards[0].months).toHaveLength(12);
    expect(data.timeline).toHaveLength(12);
    expect(data.timeline.at(-1)).toMatchObject({ owe: 450, owed: 80 });
  });

  it('el día de creación es el de la persona, aunque en UTC ya sea otro día', async () => {
    const { ana, newDebt, list } = await setup();
    // Una zona donde hoy es otra fecha que en UTC: Kiritimati (UTC+14) desde las 10 UTC, Pago Pago (UTC-11) antes
    const zone = new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
    await ana.agent.patch('/api/me').send({ timezone: zone }).expect(200);
    const id = await newDebt(ana, { amount: 120 });
    const localToday = todayIn(zone);
    expect(localToday).not.toBe(new Date().toISOString().slice(0, 10));
    const data = await list();
    expect(data.today).toBe(localToday);
    expect(data.timeline.at(-1)).toMatchObject({ month: localToday.slice(0, 7), owe: 120 });
    const history = (await ana.agent.get(`/api/debts/${id}/history`)).body.history;
    expect(history.at(-1)).toMatchObject({ kind: 'created', date: localToday });
  });

  it('avisa antes del vencimiento con los recordatorios de cada persona y para al pagar', async () => {
    const { ana, beto, carla, mail, newDebt, entry } = await setup();
    const id = await newDebt(ana, { dueDate: '2026-11-20', amount: 300 });
    await newDebt(carla, { title: 'Privada', viewMode: 'private', dueDate: '2026-11-20' });
    await newDebt(ana, { title: 'Sin fecha' });
    const debtMails = () => mail.sent.filter((m) => /Pagar (Préstamo|Privada)/.test(m.content.subject));

    expect(await debtsService.run(laTime('2026-11-16', 9))).toEqual({ debtReminders: 0 });
    expect(await debtsService.run(laTime('2026-11-17', 9))).toEqual({ debtReminders: 3 });
    expect(await debtsService.run(laTime('2026-11-17', 12))).toEqual({ debtReminders: 0 });
    const sent = debtMails();
    expect(sent.map((m) => m.to).sort()).toEqual(['ana@test.com', 'beto@test.com', 'carla@test.com']);
    const toAna = sent.find((m) => m.to === 'ana@test.com')!;
    expect(toAna.content.subject.replace(/ /g, ' ')).toBe('Pagar Préstamo carro: 300,00 US$ vence en 3 días');
    expect(toAna.content.text).toContain('Tu deuda con Banco Popular vence en 3 días');

    await entry(ana, id, { kind: 'payment', amount: 300 }).expect(201);
    await beto.agent.patch('/api/me/settings').send({ finance: false }).expect(200);
    expect(await debtsService.run(laTime('2026-11-18', 9))).toEqual({ debtReminders: 1 }); // solo la privada de Carla
    const { rows } = await db().query('SELECT count(*)::int AS n FROM debt_reminder_sends');
    expect(rows[0].n).toBe(4);
  });
});
