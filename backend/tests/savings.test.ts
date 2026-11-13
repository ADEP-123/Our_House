import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleBackground } from '../src/lib/background.js';
import { todayIn } from '../src/lib/recurrence.js';
import { resetDb, setupFamily, type User } from './helpers.js';

type Mail = { sent: { to: string; content: { subject: string; text: string } }[] };

async function createAccount(user: User, familyId: string, body: Record<string, unknown>) {
  return (await user.agent.post(`/api/families/${familyId}/accounts`).send({ kind: 'bank', ...body }).expect(201)).body.account as { id: string };
}
const account = async (user: User, id: string) => (await user.agent.get(`/api/accounts/${id}`).expect(200)).body.account;
const move = (user: User, projectId: string, accountId: string, action: string, amount: number) =>
  user.agent.post(`/api/savings/${projectId}/move`).send({ accountId, action, amount });

/** Correos enviados mientras corre la acción (incluidos los de segundo plano) */
async function mailsDuring(mail: Mail, action: () => Promise<unknown>) {
  const before = mail.sent.length;
  await action();
  await settleBackground();
  return mail.sent.slice(before);
}

describe('ahorros y presupuesto', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto']);
    const cats = Object.fromEntries(
      ((await users.ana!.agent.get(`/api/families/${familyId}/categories`)).body.categories as { id: string; name: string }[]).map((c) => [c.name, c.id]),
    );
    const nu = await createAccount(users.ana!, familyId, { name: 'Nu', prefix: 'T', opening: { amount: 1000, date: '2026-01-01' } });
    const visa = await createAccount(users.ana!, familyId, { name: 'Visa', prefix: 'V', kind: 'credit', creditLimit: 500 });
    const viaje = (await users.ana!.agent.post(`/api/families/${familyId}/savings`).send({ name: 'Viaje', icon: '✈️', goal: 500 }).expect(201)).body
      .id as string;
    const today = todayIn('America/Bogota');
    return { familyId, users, mail: mail as Mail, cats, nu, visa, viaje, today };
  }

  it('apartar y liberar: Saldo · Ahorro · Disponible, sin pasar del disponible ni usar tarjetas', async () => {
    const { familyId, users, nu, visa, viaje } = await setup();
    await move(users.ana!, viaje, nu.id, 'set_aside', 300).expect(200);
    expect((await account(users.ana!, nu.id)).savings).toEqual({
      total: 300,
      available: 700,
      projects: [{ id: viaje, name: 'Viaje', icon: '✈️', amount: 300 }],
    });
    expect((await move(users.ana!, viaje, nu.id, 'set_aside', 701).expect(400)).body).toEqual({ error: 'SAVINGS_NOT_ENOUGH', available: 700 });
    expect((await move(users.ana!, viaje, visa.id, 'set_aside', 10).expect(400)).body.error).toBe('SAVINGS_CREDIT_ACCOUNT');
    expect((await move(users.ana!, viaje, nu.id, 'release', 301).expect(400)).body.error).toBe('SAVINGS_RELEASE_TOO_MUCH');
    await move(users.ana!, viaje, nu.id, 'release', 100).expect(200);

    const list = (await users.beto!.agent.get(`/api/families/${familyId}/savings`).expect(200)).body;
    expect(list.projects[0]).toMatchObject({ name: 'Viaje', saved: 200, spent: 0, canManage: false, accounts: [{ accountId: nu.id, name: 'Nu', amount: 200 }] });
    expect(list.accounts.map((a: { name: string; available: number }) => [a.name, a.available])).toEqual([['Nu', 800]]);
    const history = (await users.ana!.agent.get(`/api/savings/${viaje}/history`).expect(200)).body.history;
    expect(history.map((h: { kind: string; amount: number }) => `${h.kind}:${h.amount}`)).toEqual(['release:100', 'set_aside:300']);
  });

  it('gastar del ahorro: descuenta de lo apartado, no pasa de él y se devuelve al borrar o quitar la marca', async () => {
    const { users, cats, nu, viaje, today } = await setup();
    await move(users.ana!, viaje, nu.id, 'set_aside', 200).expect(200);
    const spend = (body: Record<string, unknown>) =>
      users.ana!.agent.post(`/api/accounts/${nu.id}/movements`).send({ kind: 'out', date: today, description: 'Tiquetes', categoryId: cats['Ocio'], ...body });
    expect((await spend({ amount: 250, savingsProjectId: viaje }).expect(400)).body).toEqual({ error: 'SAVINGS_SPEND_TOO_MUCH', saved: 200 });
    const { id } = (await spend({ amount: 150, savingsProjectId: viaje }).expect(201)).body;
    let a = await account(users.ana!, nu.id);
    expect([a.balance, a.savings.total, a.savings.available]).toEqual([850, 50, 800]);
    const row = (await users.ana!.agent.get(`/api/accounts/${nu.id}/movements`)).body.movements.find((m: { id: string }) => m.id === id);
    expect(row.savings).toEqual({ id: viaje, name: 'Viaje', icon: '✈️' });

    // Editar sin pasar de lo apartado (lo que ya gastó este movimiento cuenta)
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ amount: 200 }).expect(200);
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ amount: 201 }).expect(400);
    // Pasarlo a entrada quita la marca
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ kind: 'in' }).expect(200);
    a = await account(users.ana!, nu.id);
    expect(a.savings.total).toBe(200);
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ kind: 'out', savingsProjectId: viaje }).expect(200);
    expect((await account(users.ana!, nu.id)).savings.total).toBe(0);
    await users.ana!.agent.delete(`/api/movements/${id}`).expect(204);
    expect((await account(users.ana!, nu.id)).savings.total).toBe(200);
  });

  it('cerrar libera lo apartado; solo quien lo creó o un líder lo cambia', async () => {
    const { familyId, users, nu } = await setup();
    const casa = (await users.beto!.agent.post(`/api/families/${familyId}/savings`).send({ name: 'Casa', icon: '🏠' }).expect(201)).body.id;
    const viaje = (await users.beto!.agent.get(`/api/families/${familyId}/savings`)).body.projects.find((p: { name: string }) => p.name === 'Viaje').id;
    expect((await users.beto!.agent.put(`/api/savings/${viaje}`).send({ name: 'Otro', icon: '🎯' }).expect(403)).body.error).toBe('SAVINGS_MANAGE_ONLY');
    await users.ana!.agent.put(`/api/savings/${casa}`).send({ name: 'Casa nueva', icon: '🏠', goal: 1000 }).expect(200); // líder

    await move(users.beto!, casa, nu.id, 'set_aside', 400).expect(200);
    await users.beto!.agent.post(`/api/savings/${casa}/close`).expect(200);
    expect((await account(users.ana!, nu.id)).savings.total).toBe(0);
    expect((await move(users.beto!, casa, nu.id, 'set_aside', 1).expect(400)).body.error).toBe('SAVINGS_CLOSED');
    await users.beto!.agent.post(`/api/savings/${casa}/reopen`).expect(200);
    await move(users.beto!, casa, nu.id, 'set_aside', 1).expect(200);
    await users.ana!.agent.delete(`/api/savings/${casa}`).expect(204);
  });

  it('lo apartado en una cuenta privada se ve como total sin decir dónde', async () => {
    const { familyId, users, viaje } = await setup();
    const secreta = await createAccount(users.ana!, familyId, { name: 'Secreta', prefix: 'S', viewMode: 'private', opening: { amount: 100, date: '2026-01-01' } });
    await move(users.ana!, viaje, secreta.id, 'set_aside', 60).expect(200);
    const project = (await users.beto!.agent.get(`/api/families/${familyId}/savings`)).body.projects[0];
    expect(project.accounts).toEqual([{ accountId: null, name: null, amount: 60 }]);
    expect((await move(users.beto!, viaje, secreta.id, 'set_aside', 1).expect(404)).body.error).toBe('ACCOUNT_NOT_FOUND');
  });

  it('meta cumplida: un correo a quien lo creó y a quien apartó, una sola vez', async () => {
    const { users, mail, nu, viaje } = await setup();
    expect(await mailsDuring(mail, () => move(users.beto!, viaje, nu.id, 'set_aside', 400).expect(200))).toEqual([]);
    const sent = await mailsDuring(mail, () => move(users.beto!, viaje, nu.id, 'set_aside', 100).expect(200));
    expect(sent.map((m) => m.to).sort()).toEqual(['ana@test.com', 'beto@test.com']);
    expect(sent[0]!.content.subject).toBe('🎯 «Viaje» llegó a la meta');
    expect(await mailsDuring(mail, () => move(users.beto!, viaje, nu.id, 'set_aside', 10).expect(200))).toEqual([]);
  });

  it('presupuesto: solo líderes; avisos al 80 y al 100 % una vez por mes; las cuentas privadas no cuentan', async () => {
    const { familyId, users, mail, cats, nu, today } = await setup();
    const food = cats['Alimentación']!;
    expect((await users.beto!.agent.put(`/api/categories/${food}/budget`).send({ amount: 100 }).expect(403)).body.error).toBe('NOT_LEADER');
    await users.ana!.agent.put(`/api/categories/${food}/budget`).send({ amount: 100 }).expect(200);
    const spend = (user: User, accountId: string, amount: number) =>
      user.agent.post(`/api/accounts/${accountId}/movements`).send({ kind: 'out', amount, date: today, description: 'Mercado', categoryId: food }).expect(201);

    const privada = await createAccount(users.beto!, familyId, { name: 'Mía', prefix: 'M', viewMode: 'private', opening: { amount: 500, date: '2026-01-01' } });
    expect(await mailsDuring(mail, () => spend(users.beto!, privada.id, 90))).toEqual([]);

    const at80 = await mailsDuring(mail, () => spend(users.beto!, nu.id, 85));
    expect(at80.map((m) => m.to).sort()).toEqual(['ana@test.com', 'beto@test.com']);
    expect(at80[0]!.content.subject).toMatch(/^Alimentación: 85 % del presupuesto de /);
    expect(await mailsDuring(mail, () => spend(users.beto!, nu.id, 5))).toEqual([]);
    const at100 = await mailsDuring(mail, () => spend(users.ana!, nu.id, 20));
    expect(at100.map((m) => m.to)).toEqual(['ana@test.com']);
    expect(at100[0]!.content.subject).toMatch(/se acabó el presupuesto/);

    const budgets = (await users.beto!.agent.get(`/api/families/${familyId}/budgets`).expect(200)).body;
    expect(budgets).toMatchObject({ month: today.slice(0, 7), canManage: false, budgets: [{ name: 'Alimentación', limit: 100, spent: 110, pct: 110 }] });
    await users.ana!.agent.put(`/api/categories/${food}/budget`).send({ amount: null }).expect(200);
    expect((await users.ana!.agent.get(`/api/families/${familyId}/budgets`)).body.budgets).toEqual([]);
  });

  it('disponible bajo: avisa al cruzar el umbral, una vez por cruce, y respeta la preferencia', async () => {
    const { users, mail, cats, nu, viaje, today } = await setup();
    const a = await account(users.ana!, nu.id);
    await users.ana!.agent
      .put(`/api/accounts/${nu.id}`)
      .send({ name: 'Nu', kind: 'bank', prefix: 'T', opening: { amount: a.opening.amount, date: a.opening.date }, lowBalanceThreshold: 200 })
      .expect(200);
    await move(users.ana!, viaje, nu.id, 'set_aside', 300).expect(200);
    const spend = (amount: number) =>
      users.beto!.agent.post(`/api/accounts/${nu.id}/movements`).send({ kind: 'out', amount, date: today, description: 'Gasto', categoryId: cats['Otros'] }).expect(201);

    const sent = await mailsDuring(mail, () => spend(600)); // disponible 100
    expect(sent.map((m) => m.to).sort()).toEqual(['ana@test.com', 'beto@test.com']);
    expect(sent[0]!.content.subject).toMatch(/^Nu: el disponible bajó de /);
    expect(sent[0]!.content.text).toContain('apartados para ahorros');
    expect(await mailsDuring(mail, () => spend(10))).toEqual([]);

    // Vuelve a subir y a bajar: avisa otra vez, salvo a quien apagó los correos de finanzas
    await users.ana!.agent.post(`/api/accounts/${nu.id}/adjust`).send({ balance: 900, date: today, description: 'Ajuste' }).expect(201);
    await settleBackground();
    await users.beto!.agent.patch('/api/me/settings').send({ finance: false }).expect(200);
    const again = await mailsDuring(mail, () => spend(500));
    expect(again.map((m) => m.to)).toEqual(['ana@test.com']);
  });
});
