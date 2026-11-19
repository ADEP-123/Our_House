import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { settleBackground } from '../src/lib/background.js';
import { cardCycle, cutBefore, dayOfMonth, nextDue, previousDue } from '../src/lib/card-payment.js';
import { cardPaymentsService } from '../src/services/card-payments.service.js';
import { connect, fakeGoogle } from './google-fake.js';
import { resetDb, setupFamily, type User } from './helpers.js';

const LA = 'America/Los_Angeles';
/** Momento en Los Ángeles (UTC-8 en noviembre) */
const laTime = (date: string, hour: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (hour + 8) * 3_600_000);

describe('fechas de pago y corte', () => {
  it('el día de pago se ajusta a meses cortos', () => {
    expect(dayOfMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(dayOfMonth(2028, 2, 30)).toBe('2028-02-29');
    expect(nextDue(15, '2026-11-15')).toBe('2026-11-15');
    expect(nextDue(15, '2026-11-16')).toBe('2026-12-15');
    expect(nextDue(31, '2026-12-31')).toBe('2026-12-31');
    expect(nextDue(30, '2027-01-31')).toBe('2027-02-28');
    expect(previousDue(31, '2026-03-31')).toBe('2026-02-28');
  });

  it('el corte es el anterior a la fecha de pago', () => {
    expect(cutBefore('2026-11-15', 28)).toBe('2026-10-28');
    expect(cutBefore('2026-11-20', 5)).toBe('2026-11-05');
    expect(cutBefore('2026-11-15', 15)).toBe('2026-10-15');
    expect(cutBefore('2026-03-10', 30)).toBe('2026-02-28');
  });

  const movements = [
    { date: '2026-10-01', kind: 'opening', amount: -300 },
    { date: '2026-10-20', kind: 'out', amount: 200 },
    { date: '2026-11-02', kind: 'out', amount: 100 },
    { date: '2026-11-05', kind: 'transfer_in', amount: 150 },
  ];

  it('con corte: la deuda al corte menos los pagos de después, sin pasar la deuda de hoy', () => {
    const c = cardCycle({ paymentDay: 15, cutDay: 28 }, '2026-11-15', movements, '2026-11-12');
    expect(c).toEqual({ due: '2026-11-15', cut: '2026-10-28', closed: true, statement: 500, paid: 150, pending: 350, debt: 450 });
    const paid = cardCycle({ paymentDay: 15, cutDay: 28 }, '2026-11-15', [...movements, { date: '2026-11-13', kind: 'in', amount: 350 }], '2026-11-13');
    expect(paid.pending).toBe(0);
    expect(paid.debt).toBe(100); // lo comprado después del corte va para el mes siguiente
  });

  it('antes del corte todavía no hay nada por pagar', () => {
    const c = cardCycle({ paymentDay: 20, cutDay: 5 }, '2026-11-20', movements, '2026-11-04');
    expect(c).toMatchObject({ cut: '2026-11-05', closed: false, pending: 0 });
  });

  it('sin corte se debe toda la deuda', () => {
    expect(cardCycle({ paymentDay: 15, cutDay: null }, '2026-11-15', movements, '2026-11-12')).toMatchObject({ cut: null, pending: 450, debt: 450 });
  });
});

/** Ana (líder) crea la tarjeta Visa con deuda y un banco; Beto (miembro) y Carla (supervisada) están en el grupo */
async function setup(card: { paymentDay?: number | null; cutDay?: number | null } = { paymentDay: 15, cutDay: 28 }) {
  const { familyId, users, mail } = await setupFamily(['ana', 'beto', 'carla'], ['carla']);
  for (const u of Object.values(users)) await u.agent.patch('/api/me').send({ timezone: LA }).expect(200);
  const ana = users.ana!;
  const category = (await ana.agent.get(`/api/families/${familyId}/categories`).expect(200)).body.categories[0].id;
  const create = (body: Record<string, unknown>) => ana.agent.post(`/api/families/${familyId}/accounts`).send(body);
  const visa = (
    await create({ name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 2000, ...card, opening: { amount: -300, date: '2026-10-01' } }).expect(201)
  ).body.account;
  const bank = (await create({ name: 'Banco', kind: 'bank', prefix: 'B', opening: { amount: 5000, date: '2026-10-01' } }).expect(201)).body.account;
  const buy = (amount: number, date: string) =>
    ana.agent.post(`/api/accounts/${visa.id}/movements`).send({ kind: 'out', amount, date, description: 'Compra', categoryId: category }).expect(201);
  const pay = (amount: number, date: string) =>
    ana.agent
      .post('/api/transfers')
      .send({ id: randomUUID(), outId: randomUUID(), inId: randomUUID(), fromAccountId: bank.id, toAccountId: visa.id, amount, date, description: 'Pago Visa' })
      .expect(201);
  await buy(200, '2026-10-20');
  await buy(100, '2026-11-02');
  await pay(150, '2026-11-05');
  return { familyId, users, mail, ana, visa, bank, buy, pay };
}

/** Correos de la tarjeta, con los espacios duros de los montos como espacios normales */
const cardMails = (mail: { sent: { to: string; content: { subject: string; text: string } }[] }) =>
  mail.sent
    .filter((m) => m.content.subject.includes('Visa'))
    .map((m) => ({ to: m.to, content: { subject: m.content.subject.replace(/\u00a0/g, ' '), text: m.content.text.replace(/\u00a0/g, ' ') } }));

describe('tarjetas: día de pago', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('guarda el día de pago y el de corte solo en tarjetas', async () => {
    const { familyId, ana, visa: created } = await setup();
    const visa = (await ana.agent.get(`/api/accounts/${created.id}`).expect(200)).body.account;
    expect(visa.credit).toMatchObject({ paymentDay: 15, cutDay: 28, debt: 450 });
    const cash = (
      await ana.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Caja', kind: 'cash', prefix: 'C', paymentDay: 10, cutDay: 1 }).expect(201)
    ).body.account;
    expect(cash.credit).toBeNull();
    const { rows } = await db().query('SELECT payment_day, cut_day FROM accounts WHERE id = $1', [cash.id]);
    expect(rows[0]).toEqual({ payment_day: null, cut_day: null });

    // Sin día de pago, el corte no se guarda
    const body = { name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 2000, paymentDay: null, cutDay: 28 };
    expect((await ana.agent.put(`/api/accounts/${visa.id}`).send(body).expect(200)).body.account.credit).toMatchObject({ paymentDay: null, cutDay: null });
    const bad = await ana.agent.put(`/api/accounts/${visa.id}`).send({ ...body, paymentDay: 32 }).expect(400);
    expect(bad.body).toEqual({ error: 'VALIDATION', fields: { paymentDay: 'PAYMENT_DAY_INVALID' } });
  });

  it('avisa por correo a quien la creó y a quien la edita, con sus recordatorios, y para al pagar', async () => {
    const { mail, pay, users } = await setup();
    await users.beto!.agent.patch('/api/me/settings').send({ reminderStartDays: 2 }).expect(200);
    const before = cardMails(mail).length;

    // 4 días antes: nadie (los recordatorios empiezan 3 días antes; Beto, 2)
    expect(await cardPaymentsService.run(laTime('2026-11-11', 9))).toEqual({ cardReminders: 0 });
    // 3 días antes, a las 9: solo Ana
    expect(await cardPaymentsService.run(laTime('2026-11-12', 9))).toEqual({ cardReminders: 1 });
    // Antes de las 8 o repetido el mismo día: nada
    expect(await cardPaymentsService.run(laTime('2026-11-13', 7))).toEqual({ cardReminders: 0 });
    expect(await cardPaymentsService.run(laTime('2026-11-12', 15))).toEqual({ cardReminders: 0 });
    // 2 días antes: Ana y Beto; Carla (supervisada) no edita la tarjeta
    expect(await cardPaymentsService.run(laTime('2026-11-13', 9))).toEqual({ cardReminders: 2 });

    const sent = cardMails(mail).slice(before);
    expect(sent.map((m) => m.to).sort()).toEqual(['ana@test.com', 'ana@test.com', 'beto@test.com']);
    expect(sent[0]!.content.subject).toBe('Pagar Visa: 350,00 US$ vence en 3 días');
    expect(sent[0]!.content.text).toContain('El corte del 28 de octubre cerró con 500,00 US$');
    expect(sent[0]!.content.text).toContain(`${env.appUrl}/finanzas?cuenta=`);

    // Paga lo que falta: no hay más avisos
    await pay(350, '2026-11-13');
    expect(await cardPaymentsService.run(laTime('2026-11-14', 9))).toEqual({ cardReminders: 0 });
  });

  it('no avisa sin día de pago, sin deuda o con los avisos de finanzas apagados', async () => {
    const { mail, users, visa, ana } = await setup({ paymentDay: null });
    expect(await cardPaymentsService.run(laTime('2026-11-12', 9))).toEqual({ cardReminders: 0 });
    await ana.agent.put(`/api/accounts/${visa.id}`).send({ name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 2000, paymentDay: 15 }).expect(200);
    for (const u of Object.values(users)) await u.agent.patch('/api/me/settings').send({ finance: false }).expect(200);
    expect(await cardPaymentsService.run(laTime('2026-11-13', 9))).toEqual({ cardReminders: 0 });
    expect(cardMails(mail)).toHaveLength(0);
  });

  it('sin corte avisa por toda la deuda', async () => {
    const { mail } = await setup({ paymentDay: 15 });
    expect(await cardPaymentsService.run(laTime('2026-11-13', 9))).toEqual({ cardReminders: 2 });
    expect(cardMails(mail)[0]!.content.subject).toBe('Pagar Visa: 450,00 US$ vence en 2 días');
  });

  describe('calendario', () => {
    beforeEach(() => {
      vi.spyOn(env.google, 'clientId', 'get').mockReturnValue('client-id');
      vi.spyOn(env.google, 'clientSecret', 'get').mockReturnValue('client-secret');
    });

    const eventsOf = (g: ReturnType<typeof fakeGoogle>) =>
      ([...g.events.values()] as { summary: string; start: { date: string }; description: string }[]).map((e) => ({
        ...e,
        summary: e.summary.replace(/\u00a0/g, ' '),
        description: e.description.replace(/\u00a0/g, ' '),
      }));

    async function connected() {
      const g = fakeGoogle();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(laTime('2026-11-12', 10));
      const s = await setup();
      await connect(s.ana as User);
      await cardPaymentsService.reconcile();
      return { g, ...s };
    }

    it('crea el evento del pago en el calendario de quien creó la tarjeta y lo marca con ✓ al pagar', async () => {
      const { g, pay, buy } = await connected();
      expect(eventsOf(g)).toHaveLength(1);
      expect(eventsOf(g)[0]).toMatchObject({ summary: '💳 Pagar Visa · 350,00 US$', start: { date: '2026-11-15' } });
      expect(eventsOf(g)[0]!.description).toContain('Corte del 28 de octubre: 500,00 US$');

      // Una compra después del corte no cambia lo de este mes
      await buy(40, '2026-11-12');
      await settleBackground();
      expect(eventsOf(g)[0]!.summary).toBe('💳 Pagar Visa · 350,00 US$');

      await pay(100, '2026-11-12');
      await settleBackground();
      expect(eventsOf(g)[0]!.summary).toBe('💳 Pagar Visa · 250,00 US$');
      await pay(250, '2026-11-12');
      await settleBackground();
      expect(eventsOf(g)).toHaveLength(1);
      expect(eventsOf(g)[0]!.summary).toBe('✓ 💳 Pagar Visa');

      // Lo que no cambió no llama a Google
      const calls = g.calls.length;
      await cardPaymentsService.reconcile();
      expect(g.calls.length).toBe(calls);
    });

    it('quitar el día de pago o archivar la tarjeta borra el evento que no ha llegado', async () => {
      const { g, ana, visa } = await connected();
      expect(g.events.size).toBe(1);
      await ana.agent.put(`/api/accounts/${visa.id}`).send({ name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 2000, paymentDay: null }).expect(200);
      await settleBackground();
      expect(g.events.size).toBe(0);
      expect((await db().query('SELECT count(*)::int AS n FROM card_calendar_events')).rows[0].n).toBe(0);
    });
  });
});
