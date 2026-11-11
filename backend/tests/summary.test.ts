import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, setupFamily, type User } from './helpers.js';

async function createAccount(user: User, familyId: string, body: Record<string, unknown>) {
  return (await user.agent.post(`/api/families/${familyId}/accounts`).send({ kind: 'bank', ...body }).expect(201)).body.account as { id: string };
}
const add = (user: User, accountId: string, body: Record<string, unknown>) =>
  user.agent.post(`/api/accounts/${accountId}/movements`).send({ kind: 'out', date: '2026-11-05', ...body }).expect(201);

describe('resumen de finanzas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const cats = Object.fromEntries(
      ((await users.ana!.agent.get(`/api/families/${familyId}/categories`)).body.categories as { id: string; name: string }[]).map((c) => [c.name, c.id]),
    );
    const nu = await createAccount(users.ana!, familyId, { name: 'Nu', prefix: 'T', opening: { amount: 100, date: '2026-01-01' } });
    const visa = await createAccount(users.ana!, familyId, { name: 'Visa', prefix: 'V', kind: 'credit', creditLimit: 1000, opening: { amount: -300, date: '2026-01-01' } });
    await add(users.ana!, nu.id, { kind: 'in', amount: 1000, description: 'Salario', categoryId: cats['Ingresos'], date: '2026-11-02' });
    await add(users.ana!, nu.id, { amount: 30, description: 'Mercado', categoryId: cats['Alimentación'] });
    await add(users.ana!, visa.id, { amount: 50, description: 'Cine', categoryId: cats['Ocio'], date: '2026-11-20' });
    await users.ana!.agent.post('/api/transfers').send({ fromAccountId: nu.id, toAccountId: visa.id, amount: 200, date: '2026-11-15', description: 'Pago' }).expect(201);
    await users.ana!.agent.post(`/api/accounts/${nu.id}/adjust`).send({ balance: 865, date: '2026-11-25', description: 'Ajuste' }).expect(201);
    return { familyId, users, cats, nu, visa };
  }

  it('noviembre: entradas, salidas, ajustes aparte, transferencias fuera y saldos', async () => {
    const { familyId, users, nu } = await setup();
    const res = await users.ana!.agent.get(`/api/families/${familyId}/summary?from=2026-11-01&to=2026-11-30&freq=week`).expect(200);
    const s = res.body;
    expect(s.currency).toBe('USD');
    expect(s.previous).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(s.accounts.map((a: { name: string }) => a.name)).toEqual(['Nu', 'Visa']);
    expect(s.combined).toMatchObject({ income: 1000, expense: 80, net: 920, adjustments: -5, transfersIn: 200, transfersOut: 200 });
    expect(s.combined.categories.map((c: { name: string; expense: number }) => [c.name, c.expense])).toEqual([
      ['Ocio', 50],
      ['Alimentación', 30],
      ['Ingresos', 0],
    ]);
    expect(s.combined.periods).toHaveLength(6);
    expect(s.balances).toEqual({ debt: 150, real: 865, complete: 865 + 850 });
    expect(s.byAccount.find((a: { accountId: string }) => a.accountId === nu.id)).toMatchObject({ income: 1000, expense: 30, closingBalance: 865 });
  });

  it('solo cuentas que la persona ve; las archivadas solo si se eligen', async () => {
    const { familyId, users, nu, visa } = await setup();
    const priv = await createAccount(users.beto!, familyId, { name: 'Secreta', prefix: 'S', viewMode: 'private', opening: { amount: 999, date: '2026-01-01' } });
    await users.ana!.agent.post(`/api/accounts/${visa.id}/archive`).expect(200);

    const def = (await users.ana!.agent.get(`/api/families/${familyId}/summary?from=2026-11-01&to=2026-11-30`).expect(200)).body;
    expect(def.accounts.map((a: { name: string }) => a.name)).toEqual(['Nu']);
    expect(def.available.map((a: { name: string; archived: boolean }) => [a.name, a.archived])).toEqual([
      ['Nu', false],
      ['Visa', true],
    ]);

    const chosen = (await users.ana!.agent.get(`/api/families/${familyId}/summary?from=2026-11-01&to=2026-11-30&accounts=${visa.id},${priv.id}`).expect(200)).body;
    expect(chosen.accounts.map((a: { name: string }) => a.name)).toEqual(['Visa']);
    expect(chosen.combined.expense).toBe(50);

    const beto = (await users.beto!.agent.get(`/api/families/${familyId}/summary?from=2026-11-01&to=2026-11-30&accounts=${priv.id},${nu.id}`).expect(200)).body;
    expect(beto.balances.real).toBe(999 + 865);
  });

  it('valida el rango y la cantidad de períodos', async () => {
    const { familyId, users } = await setup();
    await users.ana!.agent.get(`/api/families/${familyId}/summary?from=2026-12-01&to=2026-11-01`).expect(400, { error: 'SUMMARY_RANGE_INVALID' });
    await users.ana!.agent.get(`/api/families/${familyId}/summary?from=2020-01-01&to=2026-12-31&freq=week`).expect(400, { error: 'SUMMARY_TOO_MANY_PERIODS' });
    await users.ana!.agent.get(`/api/families/${familyId}/summary?from=2026-11-01&to=2026-11-30&freq=day`).expect(400);
    const other = await setupFamily(['zoe']);
    await other.users.zoe!.agent.get(`/api/families/${familyId}/summary?from=2026-11-01&to=2026-11-30`).expect(404);
  });

  it('cada persona guarda su última configuración', async () => {
    const { familyId, users, nu } = await setup();
    expect((await users.ana!.agent.get(`/api/families/${familyId}/summary/prefs`).expect(200)).body).toEqual({ config: null });
    const config = { mode: 'year', year: 2026, freq: 'month', accounts: [nu.id], view: 'both' };
    await users.ana!.agent.put(`/api/families/${familyId}/summary/prefs`).send({ config }).expect(200);
    expect((await users.ana!.agent.get(`/api/families/${familyId}/summary/prefs`)).body.config).toEqual(config);
    expect((await users.beto!.agent.get(`/api/families/${familyId}/summary/prefs`)).body.config).toBeNull();
    await users.ana!.agent.put(`/api/families/${familyId}/summary/prefs`).send({ config: { ...config, view: 'nope' } }).expect(400);
  });
});
