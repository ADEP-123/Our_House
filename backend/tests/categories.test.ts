import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { resetDb, setupFamily, type User } from './helpers.js';

type Category = { id: string; name: string; icon: string; color: string; disabled: boolean; usage: number };

const list = async (user: User, familyId: string) =>
  (await user.agent.get(`/api/families/${familyId}/categories`).expect(200)).body as { canManage: boolean; categories: Category[] };

const byName = async (user: User, familyId: string, name: string) => (await list(user, familyId)).categories.find((c) => c.name === name)!;

async function createAccount(user: User, familyId: string, body: Record<string, unknown> = {}) {
  const res = await user.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Nu', kind: 'bank', prefix: 'T', ...body }).expect(201);
  return res.body.account as { id: string };
}

/** Movimiento directo en la base (los movimientos llegan con su propio feat) */
async function addMovement(accountId: string, categoryId: string, description: string, amount = 10) {
  const id = randomUUID();
  const { rows } = await db().query<{ last_number: number }>(
    'UPDATE accounts SET last_number = last_number + 1 WHERE id = $1 RETURNING last_number',
    [accountId],
  );
  await db().query(
    `INSERT INTO account_movements (id, account_id, number, kind, amount, date, description, category_id)
     VALUES ($1, $2, $3, 'out', $4, '2026-11-01', $5, $6)`,
    [id, accountId, rows[0]!.last_number, amount, description, categoryId],
  );
  return id;
}
const categoryOf = async (movementId: string) =>
  (await db().query<{ category_id: string }>('SELECT category_id FROM account_movements WHERE id = $1', [movementId])).rows[0]!.category_id;

describe('categorías: iniciales y permisos', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('el grupo empieza con categorías en el idioma de quien abre finanzas, una sola vez', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await users.ana!.agent.patch('/api/me').send({ locale: 'en' }).expect(200);
    const first = await list(users.ana!, familyId);
    expect(first.categories.map((c) => c.name)).toContain('Food');
    expect(first.categories).toHaveLength(10);
    expect(first.canManage).toBe(true);

    // Otra persona (en español) no vuelve a sembrar
    const asBeto = await list(users.beto!, familyId);
    expect(asBeto.categories).toHaveLength(10);
    expect(asBeto.canManage).toBe(false);

    // Si los líderes borran todas, no vuelven a aparecer
    for (const c of first.categories) await users.ana!.agent.post(`/api/categories/${c.id}/delete`).send({}).expect(204);
    expect((await list(users.ana!, familyId)).categories).toEqual([]);
  });

  it('solo los líderes crean, cambian, deshabilitan y borran', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const ocio = await byName(users.ana!, familyId, 'Ocio');
    await users.beto!.agent.post(`/api/families/${familyId}/categories`).send({ name: 'Visa' }).expect(403, { error: 'NOT_LEADER' });
    await users.beto!.agent.patch(`/api/categories/${ocio.id}`).send({ name: 'x' }).expect(403, { error: 'NOT_LEADER' });
    await users.beto!.agent.post(`/api/categories/${ocio.id}/delete`).send({}).expect(403);
    await users.beto!.agent.get(`/api/categories/${ocio.id}/movements`).expect(403);
  });

  it('crear y editar: nombre único sin distinguir mayúsculas, ícono y color de las listas', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    await list(users.ana!, familyId);
    const created = await users.ana!.agent
      .post(`/api/families/${familyId}/categories`)
      .send({ name: 'Proceso Visa', icon: '🛂', color: 'teal' })
      .expect(201);
    expect(created.body.category).toMatchObject({ name: 'Proceso Visa', icon: '🛂', color: 'teal', disabled: false, usage: 0 });

    await users.ana!.agent.post(`/api/families/${familyId}/categories`).send({ name: 'proceso visa' }).expect(409, { error: 'CATEGORY_NAME_TAKEN' });
    await users.ana!.agent.patch(`/api/categories/${created.body.category.id}`).send({ name: 'OCIO' }).expect(409, { error: 'CATEGORY_NAME_TAKEN' });
    const bad = await users.ana!.agent.post(`/api/families/${familyId}/categories`).send({ name: 'X', icon: 'no', color: 'neon' }).expect(400);
    expect(bad.body.fields).toEqual({ icon: 'ICON_INVALID', color: 'CATEGORY_COLOR_INVALID' });

    const renamed = await users.ana!.agent.patch(`/api/categories/${created.body.category.id}`).send({ name: 'Visa', icon: '✈️' }).expect(200);
    expect(renamed.body.category).toMatchObject({ name: 'Visa', icon: '✈️', color: 'teal' });
  });

  it('deshabilitar y volver a habilitar', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const ocio = await byName(users.ana!, familyId, 'Ocio');
    const off = await users.ana!.agent.patch(`/api/categories/${ocio.id}`).send({ disabled: true }).expect(200);
    expect(off.body.category.disabled).toBe(true);
    expect((await byName(users.ana!, familyId, 'Ocio')).disabled).toBe(true); // sigue en la lista
    const on = await users.ana!.agent.patch(`/api/categories/${ocio.id}`).send({ disabled: false }).expect(200);
    expect(on.body.category.disabled).toBe(false);
  });
});

describe('categorías: borrar con movimientos', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('pide a dónde pasar los movimientos; mueve todos y permite elegir uno por uno', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const account = await createAccount(users.ana!, familyId);
    const ocio = await byName(users.ana!, familyId, 'Ocio');
    const otros = await byName(users.ana!, familyId, 'Otros');
    const salud = await byName(users.ana!, familyId, 'Salud');
    const cine = await addMovement(account.id, ocio.id, 'Cine');
    const farmacia = await addMovement(account.id, ocio.id, 'Farmacia');
    expect((await byName(users.ana!, familyId, 'Ocio')).usage).toBe(2);

    const movs = await users.ana!.agent.get(`/api/categories/${ocio.id}/movements`).expect(200);
    expect(movs.body.hiddenCount).toBe(0);
    expect(movs.body.movements.map((m: { code: string; description: string }) => `${m.code} ${m.description}`).sort()).toEqual([
      'T0001 Cine',
      'T0002 Farmacia',
    ]);

    await users.ana!.agent.post(`/api/categories/${ocio.id}/delete`).send({}).expect(409, { error: 'CATEGORY_IN_USE' });
    await users.ana!.agent.post(`/api/categories/${ocio.id}/delete`).send({ moveTo: ocio.id }).expect(400, { error: 'CATEGORY_TARGET_INVALID' });
    await users.ana!.agent.post(`/api/categories/${ocio.id}/delete`).send({ moveTo: randomUUID() }).expect(400);

    await users.ana!.agent
      .post(`/api/categories/${ocio.id}/delete`)
      .send({ moveTo: otros.id, overrides: [{ movementId: farmacia, categoryId: salud.id }] })
      .expect(204);
    expect(await categoryOf(cine)).toBe(otros.id);
    expect(await categoryOf(farmacia)).toBe(salud.id);
    expect((await list(users.ana!, familyId)).categories.some((c) => c.name === 'Ocio')).toBe(false);
  });

  it('los movimientos de cuentas que el líder no ve no se muestran ni se eligen uno por uno', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const mine = await createAccount(users.beto!, familyId, { name: 'Mía', prefix: 'M', viewMode: 'private' });
    const ocio = await byName(users.ana!, familyId, 'Ocio');
    const otros = await byName(users.ana!, familyId, 'Otros');
    const salud = await byName(users.ana!, familyId, 'Salud');
    const hidden = await addMovement(mine.id, ocio.id, 'Privado');

    const movs = await users.ana!.agent.get(`/api/categories/${ocio.id}/movements`).expect(200);
    expect(movs.body).toEqual({ movements: [], hiddenCount: 1 });

    await users.ana!.agent
      .post(`/api/categories/${ocio.id}/delete`)
      .send({ moveTo: otros.id, overrides: [{ movementId: hidden, categoryId: salud.id }] })
      .expect(204);
    expect(await categoryOf(hidden)).toBe(otros.id); // el override se ignora: va al destino de todos
  });

  it('no se puede pasar movimientos a una categoría de otro grupo', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const other = await setupFamily(['zoe']);
    const foreign = (await list(other.users.zoe!, other.familyId)).categories[0]!;
    const account = await createAccount(users.ana!, familyId);
    const ocio = await byName(users.ana!, familyId, 'Ocio');
    await addMovement(account.id, ocio.id, 'Cine');
    await users.ana!.agent.post(`/api/categories/${ocio.id}/delete`).send({ moveTo: foreign.id }).expect(400, { error: 'CATEGORY_TARGET_INVALID' });
    await other.users.zoe!.agent.get(`/api/families/${familyId}/categories`).expect(404);
  });
});
