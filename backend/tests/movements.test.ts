import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, setupFamily, type User } from './helpers.js';

type Movement = {
  id: string;
  code: string;
  kind: string;
  amount: number;
  signedAmount: number;
  date: string;
  description: string;
  category: { id: string; name: string } | null;
  createdBy: { nickname: string } | null;
  edited: boolean;
  balance: number;
};

async function createAccount(user: User, familyId: string, body: Record<string, unknown> = {}) {
  const res = await user.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Nu', kind: 'bank', prefix: 'T', ...body }).expect(201);
  return res.body.account as { id: string };
}
const categories = async (user: User, familyId: string) =>
  Object.fromEntries(
    ((await user.agent.get(`/api/families/${familyId}/categories`).expect(200)).body.categories as { id: string; name: string }[]).map((c) => [
      c.name,
      c.id,
    ]),
  ) as Record<string, string>;
const list = async (user: User, accountId: string) =>
  (await user.agent.get(`/api/accounts/${accountId}/movements`).expect(200)).body as { movements: Movement[]; hiddenColumns: string[] };
const balance = async (user: User, accountId: string) => (await user.agent.get(`/api/accounts/${accountId}`).expect(200)).body.account.balance as number;

async function add(user: User, accountId: string, body: Record<string, unknown>) {
  const res = await user.agent.post(`/api/accounts/${accountId}/movements`).send({ kind: 'out', date: '2026-11-01', ...body }).expect(201);
  return res.body.id as string;
}

async function setup(names = ['ana']) {
  const { familyId, users } = await setupFamily(names);
  const account = await createAccount(users.ana!, familyId, { opening: { amount: 100, date: '2026-01-01' } });
  const cats = await categories(users.ana!, familyId);
  return { familyId, users, account, cats };
}

describe('movimientos: crear, saldo y validaciones', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('entradas y salidas con ID consecutivo y saldo acumulado por fecha', async () => {
    const { users, account, cats } = await setup();
    await add(users.ana!, account.id, { kind: 'in', amount: 50, description: 'Salario', categoryId: cats['Ingresos'], date: '2026-11-05' });
    await add(users.ana!, account.id, { amount: 30.25, description: 'Mercado', categoryId: cats['Alimentación'], date: '2026-11-10' });
    // Uno con fecha anterior: el saldo se recalcula en orden de fecha
    await add(users.ana!, account.id, { amount: 20, description: 'Bus', categoryId: cats['Transporte'], date: '2026-11-02' });

    const { movements } = await list(users.ana!, account.id);
    expect(movements.map((m) => [m.code, m.date, m.description, m.signedAmount, m.balance])).toEqual([
      ['T0001', '2026-01-01', 'Saldo inicial', 100, 100],
      ['T0004', '2026-11-02', 'Bus', -20, 80],
      ['T0002', '2026-11-05', 'Salario', 50, 130],
      ['T0003', '2026-11-10', 'Mercado', -30.25, 99.75],
    ]);
    expect(movements[1]).toMatchObject({ category: { name: 'Transporte' }, createdBy: { nickname: 'ana' }, edited: false });
    expect(await balance(users.ana!, account.id)).toBe(99.75);
  });

  it('valida monto, descripción y categoría (del grupo y habilitada)', async () => {
    const { users, account, cats } = await setup();
    const post = (body: Record<string, unknown>) =>
      users.ana!.agent.post(`/api/accounts/${account.id}/movements`).send({ kind: 'out', date: '2026-11-01', amount: 5, description: 'X', categoryId: cats['Ocio'], ...body });

    expect((await post({ amount: 0 }).expect(400)).body.fields).toEqual({ amount: 'MOVEMENT_AMOUNT_INVALID' });
    expect((await post({ description: '  ' }).expect(400)).body.fields).toEqual({ description: 'MOVEMENT_DESCRIPTION_REQUIRED' });
    expect((await post({ categoryId: undefined }).expect(400)).body.fields).toEqual({ categoryId: 'CATEGORY_REQUIRED' });
    await post({ categoryId: randomUUID() }).expect(400, { error: 'CATEGORY_NOT_FOUND' });

    const other = await setupFamily(['zoe']);
    const foreign = Object.values(await categories(other.users.zoe!, other.familyId))[0]!;
    await post({ categoryId: foreign }).expect(400, { error: 'CATEGORY_NOT_FOUND' });

    await users.ana!.agent.patch(`/api/categories/${cats['Ocio']}`).send({ disabled: true }).expect(200);
    await post({}).expect(400, { error: 'CATEGORY_DISABLED' });
  });

  it('reenviar la misma creación (mismo id) no duplica', async () => {
    const { users, account, cats } = await setup();
    const id = randomUUID();
    await add(users.ana!, account.id, { id, amount: 10, description: 'Pan', categoryId: cats['Alimentación'] });
    await add(users.ana!, account.id, { id, amount: 10, description: 'Pan', categoryId: cats['Alimentación'] });
    expect((await list(users.ana!, account.id)).movements).toHaveLength(2); // saldo inicial + 1
  });
});

describe('movimientos: permisos', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('quien solo ve no agrega ni cambia; archivada no se edita; quien no ve, no existe', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'caro']);
    const cats = await categories(users.ana!, familyId);
    const account = await createAccount(users.ana!, familyId, { editRoles: ['leader'] });
    const priv = await createAccount(users.ana!, familyId, { name: 'Mía', prefix: 'M', viewMode: 'private' });
    const id = await add(users.ana!, account.id, { amount: 5, description: 'Cine', categoryId: cats['Ocio'] });
    const hidden = await add(users.ana!, priv.id, { amount: 5, description: 'Secreto', categoryId: cats['Ocio'] });

    const body = { kind: 'out', amount: 1, date: '2026-11-01', description: 'X', categoryId: cats['Ocio'] };
    await users.beto!.agent.post(`/api/accounts/${account.id}/movements`).send(body).expect(403, { error: 'ACCOUNT_READ_ONLY' });
    await users.beto!.agent.patch(`/api/movements/${id}`).send({ amount: 9 }).expect(403, { error: 'ACCOUNT_READ_ONLY' });
    await users.beto!.agent.delete(`/api/movements/${id}`).expect(403);
    expect((await list(users.beto!, account.id)).movements).toHaveLength(1); // sí lo ve

    await users.beto!.agent.patch(`/api/movements/${hidden}`).send({ amount: 9 }).expect(404, { error: 'MOVEMENT_NOT_FOUND' });
    await users.beto!.agent.get(`/api/movements/${hidden}/history`).expect(404);
    await users.beto!.agent.get(`/api/accounts/${priv.id}/movements`).expect(404);

    await users.ana!.agent.post(`/api/accounts/${account.id}/archive`).expect(200);
    await users.ana!.agent.post(`/api/accounts/${account.id}/movements`).send(body).expect(403, { error: 'ACCOUNT_ARCHIVED' });
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ amount: 9 }).expect(403, { error: 'ACCOUNT_ARCHIVED' });
  });

  it('las personas elegidas para editar agregan y cambian movimientos de cualquiera', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const cats = await categories(users.ana!, familyId);
    const account = await createAccount(users.ana!, familyId, { editMode: 'members', editors: [users.beto!.user.id] });
    const id = await add(users.ana!, account.id, { amount: 5, description: 'Cine', categoryId: cats['Ocio'] });
    await users.beto!.agent.patch(`/api/movements/${id}`).send({ amount: 7 }).expect(200);
    await add(users.beto!, account.id, { amount: 3, description: 'Café', categoryId: cats['Ocio'] });
    expect(await balance(users.ana!, account.id)).toBe(-10);
  });
});

describe('movimientos: editar, historial, borrar y deshacer', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('editar guarda solo lo que cambió en el historial, con nombres de categoría', async () => {
    const { users, account, cats } = await setup(['ana', 'beto']);
    const id = await add(users.ana!, account.id, { amount: 10, description: 'Cine', categoryId: cats['Ocio'] });

    await users.ana!.agent.patch(`/api/movements/${id}`).send({ amount: 10, description: 'Cine' }).expect(200); // sin cambios
    await users.beto!.agent
      .patch(`/api/movements/${id}`)
      .send({ kind: 'in', amount: 12.5, categoryId: cats['Otros'], date: '2026-11-03' })
      .expect(200);

    const m = (await list(users.ana!, account.id)).movements.find((x) => x.id === id)!;
    expect(m).toMatchObject({ kind: 'in', amount: 12.5, date: '2026-11-03', category: { name: 'Otros' }, edited: true });
    const { history } = (await users.ana!.agent.get(`/api/movements/${id}/history`).expect(200)).body;
    expect(history.map((h: { action: string; actor: { nickname: string } }) => [h.action, h.actor.nickname])).toEqual([
      ['created', 'ana'],
      ['updated', 'beto'],
    ]);
    expect(history[1].changes).toEqual({ kind: ['out', 'in'], amount: [10, 12.5], date: ['2026-11-01', '2026-11-03'], category: ['Ocio', 'Otros'] });
  });

  it('una categoría deshabilitada se puede conservar al editar, pero no elegir de nuevo', async () => {
    const { users, account, cats } = await setup();
    const id = await add(users.ana!, account.id, { amount: 10, description: 'Cine', categoryId: cats['Ocio'] });
    await users.ana!.agent.patch(`/api/categories/${cats['Ocio']}`).send({ disabled: true }).expect(200);
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ description: 'Cine 2', categoryId: cats['Ocio'] }).expect(200);
    const other = await add(users.ana!, account.id, { amount: 1, description: 'Pan', categoryId: cats['Alimentación'] });
    await users.ana!.agent.patch(`/api/movements/${other}`).send({ categoryId: cats['Ocio'] }).expect(400, { error: 'CATEGORY_DISABLED' });
  });

  it('borrar lo saca del saldo y de la lista; deshacer lo devuelve; el número no se reutiliza', async () => {
    const { users, account, cats } = await setup();
    const id = await add(users.ana!, account.id, { amount: 40, description: 'Zapatos', categoryId: cats['Otros'] });
    await users.ana!.agent.delete(`/api/movements/${id}`).expect(204);
    expect(await balance(users.ana!, account.id)).toBe(100);
    expect((await list(users.ana!, account.id)).movements.map((m) => m.code)).toEqual(['T0001']);
    await users.ana!.agent.patch(`/api/movements/${id}`).send({ amount: 1 }).expect(404);

    await users.ana!.agent.post(`/api/movements/${id}/restore`).expect(200);
    expect(await balance(users.ana!, account.id)).toBe(60);

    await users.ana!.agent.delete(`/api/movements/${id}`).expect(204);
    await add(users.ana!, account.id, { amount: 1, description: 'Chicle', categoryId: cats['Otros'] });
    expect((await list(users.ana!, account.id)).movements.map((m) => m.code)).toEqual(['T0001', 'T0003']);

    const { history } = (await users.ana!.agent.get(`/api/movements/${(await list(users.ana!, account.id)).movements[1]!.id}/history`)).body;
    expect(history).toHaveLength(1);
  });

  it('el saldo inicial no se cambia ni se borra desde los movimientos', async () => {
    const { users, account } = await setup();
    const opening = (await list(users.ana!, account.id)).movements[0]!;
    await users.ana!.agent.patch(`/api/movements/${opening.id}`).send({ amount: 5 }).expect(400, { error: 'MOVEMENT_NOT_EDITABLE' });
    await users.ana!.agent.delete(`/api/movements/${opening.id}`).expect(400, { error: 'MOVEMENT_NOT_EDITABLE' });
  });

  it('borrar una categoría con movimientos borrados no falla', async () => {
    const { users, account, cats } = await setup();
    const id = await add(users.ana!, account.id, { amount: 40, description: 'Zapatos', categoryId: cats['Deporte'] });
    await users.ana!.agent.delete(`/api/movements/${id}`).expect(204);
    await users.ana!.agent.post(`/api/categories/${cats['Deporte']}/delete`).send({}).expect(204);
  });
});

describe('movimientos: ajustar saldo, sugerencias y columnas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('ajustar saldo crea un movimiento por la diferencia', async () => {
    const { users, account, cats } = await setup();
    await add(users.ana!, account.id, { amount: 10, description: 'Pan', categoryId: cats['Alimentación'] });
    const body = { balance: 75.5, date: '2026-11-09', description: 'Ajuste de saldo' };
    await users.ana!.agent.post(`/api/accounts/${account.id}/adjust`).send(body).expect(201);
    const { movements } = await list(users.ana!, account.id);
    expect(movements.at(-1)).toMatchObject({ code: 'T0003', kind: 'adjust', signedAmount: -14.5, balance: 75.5, category: null });
    await users.ana!.agent.post(`/api/accounts/${account.id}/adjust`).send(body).expect(400, { error: 'NOTHING_TO_ADJUST' });

    // Un ajuste se puede corregir (con signo), pero no cambiar de tipo
    const adj = movements.at(-1)!;
    await users.ana!.agent.patch(`/api/movements/${adj.id}`).send({ amount: 5 }).expect(200);
    expect(await balance(users.ana!, account.id)).toBe(95);
    await users.ana!.agent.patch(`/api/movements/${adj.id}`).send({ amount: 0 }).expect(400);
  });

  it('sugerencias: la descripción más reciente con su categoría, solo de cuentas que ve', async () => {
    const { familyId, users, account, cats } = await setup(['ana', 'beto']);
    await add(users.ana!, account.id, { amount: 2, description: 'Gasolina auto', categoryId: cats['Otros'] });
    await add(users.ana!, account.id, { amount: 2, description: 'gasolina auto', categoryId: cats['Transporte'] });
    await add(users.ana!, account.id, { amount: 2, description: 'Gas Yosemite', categoryId: cats['Ocio'] });
    const priv = await createAccount(users.beto!, familyId, { name: 'Mía', prefix: 'M', viewMode: 'private' });
    await add(users.beto!, priv.id, { amount: 2, description: 'Gastos secretos', categoryId: cats['Otros'] });

    const res = await users.ana!.agent.get(`/api/families/${familyId}/movement-suggestions?q=gas`).expect(200);
    expect(res.body.suggestions).toEqual([
      { description: 'Gas Yosemite', kind: 'out', categoryId: cats['Ocio'] },
      { description: 'gasolina auto', kind: 'out', categoryId: cats['Transporte'] },
    ]);
    const asBeto = await users.beto!.agent.get(`/api/families/${familyId}/movement-suggestions?q=gastos`).expect(200);
    expect(asBeto.body.suggestions).toHaveLength(1);
    expect((await users.ana!.agent.get(`/api/families/${familyId}/movement-suggestions?q=%25`)).body.suggestions).toEqual([]);
  });

  it('cada persona oculta sus propias columnas en cada cuenta', async () => {
    const { users, account } = await setup(['ana', 'beto']);
    await users.ana!.agent.put(`/api/accounts/${account.id}/prefs`).send({ hiddenColumns: ['code', 'createdBy', 'code'] }).expect(200);
    expect((await list(users.ana!, account.id)).hiddenColumns).toEqual(['code', 'createdBy']);
    expect((await list(users.beto!, account.id)).hiddenColumns).toEqual([]);
    await users.ana!.agent.put(`/api/accounts/${account.id}/prefs`).send({ hiddenColumns: ['nope'] }).expect(400);
  });
});
