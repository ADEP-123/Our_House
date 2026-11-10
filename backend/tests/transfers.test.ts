import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, setupFamily, type User } from './helpers.js';

type Movement = {
  id: string;
  code: string;
  kind: string;
  signedAmount: number;
  balance: number;
  description: string;
  category: unknown;
  transfer: { id: string; accountId: string | null; accountName: string | null; code: string | null } | null;
};

async function createAccount(user: User, familyId: string, body: Record<string, unknown>) {
  return (await user.agent.post(`/api/families/${familyId}/accounts`).send({ kind: 'bank', ...body }).expect(201)).body.account as { id: string };
}
const list = async (user: User, accountId: string) =>
  (await user.agent.get(`/api/accounts/${accountId}/movements`).expect(200)).body.movements as Movement[];
const account = async (user: User, id: string) => (await user.agent.get(`/api/accounts/${id}`).expect(200)).body.account;
const transfer = (user: User, body: Record<string, unknown>) =>
  user.agent.post('/api/transfers').send({ amount: 50, date: '2026-11-05', description: 'Pago tarjeta', ...body });

async function setup(names = ['ana']) {
  const { familyId, users } = await setupFamily(names);
  const bank = await createAccount(users.ana!, familyId, { name: 'Nu', prefix: 'T', opening: { amount: 500, date: '2026-01-01' } });
  const card = await createAccount(users.ana!, familyId, { name: 'Visa', prefix: 'V', kind: 'credit', creditLimit: 1000, opening: { amount: -300, date: '2026-01-01' } });
  return { familyId, users, bank, card };
}

describe('transferencias', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('pagar la tarjeta: sale del banco, entra en la tarjeta (baja la deuda), sin categoría, con IDs de cada cuenta', async () => {
    const { users, bank, card } = await setup();
    const res = await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: card.id, amount: 120.5 }).expect(201);
    expect(res.body).toMatchObject({ id: expect.any(String), outId: expect.any(String), inId: expect.any(String) });

    const out = (await list(users.ana!, bank.id)).at(-1)!;
    const inn = (await list(users.ana!, card.id)).at(-1)!;
    expect(out).toMatchObject({ code: 'T0002', kind: 'transfer_out', signedAmount: -120.5, balance: 379.5, category: null, transfer: { accountName: 'Visa', code: 'V0002' } });
    expect(inn).toMatchObject({ code: 'V0002', kind: 'transfer_in', signedAmount: 120.5, balance: -179.5, transfer: { accountName: 'Nu', code: 'T0002' } });
    expect((await account(users.ana!, card.id)).credit).toMatchObject({ debt: 179.5, available: 820.5 });
  });

  it('validaciones: misma cuenta, monto, cuenta inexistente o de otro grupo', async () => {
    const { users, bank } = await setup();
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: bank.id }).expect(400, { error: 'TRANSFER_SAME_ACCOUNT' });
    expect((await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: randomUUID(), amount: 0 }).expect(400)).body.fields).toEqual({
      amount: 'MOVEMENT_AMOUNT_INVALID',
    });
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: randomUUID() }).expect(404, { error: 'ACCOUNT_NOT_FOUND' });
    const other = await setupFamily(['zoe']);
    const foreign = await createAccount(other.users.zoe!, other.familyId, { name: 'Z', prefix: 'Z' });
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: foreign.id }).expect(404);
  });

  it('pide poder editar las dos cuentas; archivada no recibe', async () => {
    const { familyId, users, bank } = await setup(['ana', 'beto']);
    const mine = await createAccount(users.beto!, familyId, { name: 'Beto', prefix: 'B' });
    await transfer(users.beto!, { fromAccountId: mine.id, toAccountId: bank.id }).expect(201); // Nu: líderes y miembros editan
    const leadersOnly = await createAccount(users.ana!, familyId, { name: 'Casa', prefix: 'C', editRoles: ['leader'] });
    await transfer(users.beto!, { fromAccountId: mine.id, toAccountId: leadersOnly.id }).expect(403, { error: 'ACCOUNT_READ_ONLY' });
    await users.ana!.agent.post(`/api/accounts/${leadersOnly.id}/archive`).expect(200);
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: leadersOnly.id }).expect(403, { error: 'ACCOUNT_ARCHIVED' });
  });

  it('editar una mitad cambia las dos; no se cambia el tipo ni se pone categoría', async () => {
    const { familyId, users, bank, card } = await setup(['ana', 'beto']);
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: card.id }).expect(201);
    const inn = (await list(users.ana!, card.id)).at(-1)!;
    await users.beto!.agent.patch(`/api/movements/${inn.id}`).send({ amount: 80, date: '2026-11-06', description: 'Pago Visa' }).expect(200);
    const out = (await list(users.ana!, bank.id)).at(-1)!;
    expect(out).toMatchObject({ signedAmount: -80, description: 'Pago Visa' });
    expect(await account(users.ana!, bank.id)).toMatchObject({ balance: 420 });

    const cats = (await users.ana!.agent.get(`/api/families/${familyId}/categories`)).body.categories;
    await users.ana!.agent.patch(`/api/movements/${out.id}`).send({ categoryId: cats[0].id }).expect(400, { error: 'TRANSFER_FIELDS_FIXED' });
    await users.ana!.agent.patch(`/api/movements/${out.id}`).send({ kind: 'in' }).expect(400, { error: 'TRANSFER_FIELDS_FIXED' });

    const { history } = (await users.ana!.agent.get(`/api/movements/${out.id}/history`)).body;
    expect(history.map((h: { action: string }) => h.action)).toEqual(['created', 'updated']);
  });

  it('borrar una mitad borra las dos; deshacer las devuelve', async () => {
    const { users, bank, card } = await setup();
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: card.id, amount: 100 }).expect(201);
    const out = (await list(users.ana!, bank.id)).at(-1)!;
    await users.ana!.agent.delete(`/api/movements/${out.id}`).expect(204);
    expect((await list(users.ana!, card.id)).map((m) => m.kind)).toEqual(['opening']);
    expect(await account(users.ana!, bank.id)).toMatchObject({ balance: 500 });
    await users.ana!.agent.post(`/api/movements/${out.id}/restore`).expect(200);
    expect((await account(users.ana!, card.id)).balance).toBe(-200);
  });

  it('si la otra cuenta es privada de otra persona: no se ve su nombre y no se puede cambiar desde este lado', async () => {
    const { familyId, users, bank } = await setup(['ana', 'beto']);
    const priv = await createAccount(users.beto!, familyId, { name: 'Secreta', prefix: 'S', viewMode: 'private' });
    await transfer(users.beto!, { fromAccountId: priv.id, toAccountId: bank.id, amount: 10 }).expect(201);
    const inn = (await list(users.ana!, bank.id)).at(-1)!;
    expect(inn.transfer).toMatchObject({ accountId: null, accountName: null, code: null });
    await users.ana!.agent.patch(`/api/movements/${inn.id}`).send({ amount: 5 }).expect(403, { error: 'TRANSFER_READ_ONLY' });
    await users.ana!.agent.delete(`/api/movements/${inn.id}`).expect(403, { error: 'TRANSFER_READ_ONLY' });
  });

  it('reenviar la misma transferencia (mismos ids) no duplica', async () => {
    const { users, bank, card } = await setup();
    const ids = { id: randomUUID(), outId: randomUUID(), inId: randomUUID() };
    await transfer(users.ana!, { ...ids, fromAccountId: bank.id, toAccountId: card.id }).expect(201);
    await transfer(users.ana!, { ...ids, fromAccountId: bank.id, toAccountId: card.id }).expect(201);
    expect(await list(users.ana!, bank.id)).toHaveLength(2);
    const out = (await list(users.ana!, bank.id)).at(-1)!;
    expect(out.id).toBe(ids.outId);
  });

  it('las sugerencias no ofrecen transferencias', async () => {
    const { familyId, users, bank, card } = await setup();
    await transfer(users.ana!, { fromAccountId: bank.id, toAccountId: card.id, description: 'Pago tarjeta' }).expect(201);
    const res = await users.ana!.agent.get(`/api/families/${familyId}/movement-suggestions?q=pago`).expect(200);
    expect(res.body.suggestions).toEqual([]);
  });
});
