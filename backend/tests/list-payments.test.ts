import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { settleBackground } from '../src/lib/background.js';
import { createList, resetDb, setupFamily, type User } from './helpers.js';

type Body = Record<string, unknown>;
type Movement = { id: string; code: string; description: string; amount: number; kind: string; purchase: boolean; category: { name: string } | null };

describe('registrar pago de una lista de compras', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const cats = Object.fromEntries(
      ((await users.ana!.agent.get(`/api/families/${familyId}/categories`)).body.categories as { id: string; name: string }[]).map((c) => [c.name, c.id]),
    );
    const account = async (user: User, body: Body) =>
      (await user.agent.post(`/api/families/${familyId}/accounts`).send({ kind: 'bank', ...body }).expect(201)).body.account as { id: string };
    const nu = await account(users.ana!, { name: 'Nu', prefix: 'T', opening: { amount: 1000, date: '2026-01-01' } });
    const list = await createList(users.ana!, familyId, { name: 'Súper' });
    const add = async (text: string, body: Body = {}) =>
      (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text, ...body }).expect(201)).body.item as { id: string };
    const buy = (itemId: string, spent: number, body: Body = {}, user: User = users.ana!) =>
      user.agent.post(`/api/lists/${list.id}/items/${itemId}/purchases`).send({ id: randomUUID(), spent, ...body }).expect(200);
    const pending = async (user: User = users.ana!) => (await user.agent.get(`/api/lists/${list.id}/payments`).expect(200)).body;
    const pay = (body: Body, user: User = users.ana!) => user.agent.post(`/api/lists/${list.id}/payments`).send(body);
    const movements = async (accountId = nu.id) =>
      ((await users.ana!.agent.get(`/api/accounts/${accountId}/movements`)).body.movements as Movement[]).filter((m) => m.kind !== 'opening');
    const balance = async () =>
      ((await users.ana!.agent.get(`/api/families/${familyId}/accounts`)).body.accounts as { id: string; balance: number }[]).find((a) => a.id === nu.id)!.balance;
    return { familyId, users, cats, nu, list, add, buy, pending, pay, movements, balance, account };
  }

  it('junta lo pagado desde el último pago en un solo movimiento y recuerda cuenta y categoría', async () => {
    const { cats, nu, add, buy, pending, pay, movements, balance } = await setup();
    const leche = await add('Leche', { amount: 2 });
    const pan = await add('Pan');
    await add('Huevos'); // sin comprar: no entra
    await buy(leche.id, 1.5, { amount: 1 }); // parcial
    await buy(leche.id, 1.25, { amount: 1 });
    await buy(pan.id, 2);

    const before = await pending();
    expect(before).toMatchObject({ total: 4.75, accountId: null, categoryId: null, canRegister: true, paidItems: [], recent: [] });
    expect(before.items.map((i: { amount: number }) => i.amount)).toEqual([2.75, 2]);
    expect(before.accounts.map((a: { name: string }) => a.name)).toEqual(['Nu']);

    // La primera vez la categoría es obligatoria
    expect((await pay({ accountId: nu.id }).expect(400)).body.error).toBe('CATEGORY_REQUIRED');
    const paid = (await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201)).body;
    expect(paid).toMatchObject({ amount: 4.75, items: 2, movementCode: 'T0002' });

    const [m] = await movements();
    expect(m).toMatchObject({ description: 'Súper · 2 artículos', amount: 4.75, kind: 'out', purchase: true, category: { name: 'Alimentación' } });
    expect(await balance()).toBe(995.25);

    const after = await pending();
    expect(after).toMatchObject({ total: 0, items: [], accountId: nu.id, categoryId: cats['Alimentación'] });
    expect(after.paidItems.sort()).toEqual([leche.id, pan.id].sort());
    expect(after.recent[0]).toMatchObject({ amount: 4.75, items: 2, registered: true, account: { name: 'Nu' }, movementCode: 'T0002', by: { nickname: 'ana' } });

    // Nada pendiente: no se crea nada
    expect((await pay({ accountId: nu.id }).expect(400)).body.error).toBe('PAYMENT_NOTHING_PENDING');

    // Lo que se paga después va en el siguiente pago, con la categoría recordada
    const huevos = await add('Huevos 2');
    await buy(huevos.id, 3);
    expect((await pay({ accountId: nu.id }).expect(201)).body).toMatchObject({ amount: 3, items: 1 });
    expect((await movements()).map((x) => [x.description, x.amount])).toEqual([
      ['Súper · 2 artículos', 4.75],
      ['Súper · 1 artículo', 3],
    ]);
  });

  it('"No registrar" lo da por pagado sin crear movimiento; un reenvío no paga dos veces', async () => {
    const { nu, cats, add, buy, pending, pay, movements } = await setup();
    const pan = await add('Pan');
    await buy(pan.id, 2);
    const id = randomUUID();
    expect((await pay({ id, accountId: null }).expect(201)).body).toMatchObject({ amount: 2, movementCode: null });
    await pay({ id, accountId: null }).expect(201);
    const p = await pending();
    expect(p).toMatchObject({ total: 0, paidItems: [] });
    expect(p.recent).toHaveLength(1);
    expect(p.recent[0]).toMatchObject({ registered: false, account: null });
    expect(await movements()).toEqual([]);

    // Pagar el mismo id con cuenta tampoco duplica
    await buy(pan.id, 1);
    const again = randomUUID();
    await pay({ id: again, accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    await pay({ id: again, accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    expect(await movements()).toHaveLength(1);
  });

  it('desmarcar un artículo pagado lo descuenta del movimiento; si queda en cero se borra', async () => {
    const { nu, cats, list, users, add, buy, pending, pay, movements, balance } = await setup();
    const leche = await add('Leche');
    const pan = await add('Pan');
    await buy(leche.id, 3);
    await buy(pan.id, 2);
    await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    const uncheck = (itemId: string) => users.beto!.agent.put(`/api/lists/${list.id}/items/${itemId}/completed`).send({ completed: false }).expect(200);

    await uncheck(leche.id);
    let [m] = await movements();
    expect(m).toMatchObject({ amount: 2 });
    expect(await balance()).toBe(998);
    expect((await pending()).paidItems).toEqual([pan.id]);
    const history = (await users.ana!.agent.get(`/api/movements/${m!.id}/history`).expect(200)).body.history as { action: string; changes: unknown }[];
    expect(history.map((h) => h.action)).toContain('updated');

    await uncheck(pan.id);
    expect(await movements()).toEqual([]);
    expect(await balance()).toBe(1000);
    const p = await pending();
    expect(p.recent[0]).toMatchObject({ amount: 0, items: 0, movementCode: null, movementDeleted: true });

    // Volver a comprarlo queda pendiente de nuevo
    await buy(leche.id, 4);
    expect((await pending()).total).toBe(4);
    [m] = await movements();
    expect(m).toBeUndefined();
  });

  it('reiniciar la lista borra los movimientos de sus pagos', async () => {
    const { nu, cats, list, users, add, buy, pay, movements, pending } = await setup();
    const a = await add('A');
    const b = await add('B');
    await buy(a.id, 1);
    await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    await buy(b.id, 2);
    await pay({ accountId: nu.id }).expect(201);
    expect(await movements()).toHaveLength(2);
    await users.ana!.agent.post(`/api/lists/${list.id}/reset`).expect(200);
    expect(await movements()).toEqual([]);
    expect(await pending()).toMatchObject({ total: 0, paidItems: [] });
  });

  it('borrar un artículo pagado no cambia el movimiento', async () => {
    const { nu, cats, list, users, add, buy, pay, movements } = await setup();
    const a = await add('A');
    await buy(a.id, 5);
    await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    await users.ana!.agent.delete(`/api/lists/${list.id}/items/${a.id}`).expect(204);
    expect((await movements()).map((m) => m.amount)).toEqual([5]);
  });

  it('lo pagado de un artículo que se repite no se pierde al volver a la lista', async () => {
    const { nu, cats, list, users, add, buy, pending, pay } = await setup();
    // Con fecha: al completarse pasa a la siguiente fecha en el acto
    const leche = await add('Leche', { amount: 1, dueDate: '2030-03-04', repeat: { freq: 'weekly' } });
    await buy(leche.id, 2.5);
    const item = (await users.ana!.agent.get(`/api/lists/${list.id}`)).body.list.items[0];
    expect(item).toMatchObject({ dueDate: '2030-03-11', spent: null });
    expect((await pending()).total).toBe(2.5);
    // Sin fecha: vuelve cuando toca
    const pan = await add('Pan', { repeat: { freq: 'weekly' } });
    await buy(pan.id, 1);
    await db().query('UPDATE list_items SET reopen_on = current_date WHERE id = $1', [pan.id]);
    await users.ana!.agent.get(`/api/lists/${list.id}`).expect(200);
    await users.ana!.agent.get(`/api/lists/${list.id}`).expect(200); // abrirla dos veces no duplica
    expect((await pending()).total).toBe(3.5);
    await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    expect((await pending()).total).toBe(0);
    // La vuelta siguiente empieza de cero
    await buy(pan.id, 1.2);
    expect((await pending()).total).toBe(1.2);
  });

  it('permisos: solo cuentas donde la persona puede registrar; lista archivada o sin compras no', async () => {
    const { familyId, users, cats, nu, list, add, buy, pending, pay, account } = await setup();
    const mia = await account(users.ana!, { name: 'Mía', prefix: 'M', viewMode: 'private' });
    const pan = await add('Pan');
    await buy(pan.id, 2);
    expect((await pending(users.beto!)).accounts.map((a: { name: string }) => a.name)).toEqual(['Nu']);
    expect((await pay({ accountId: mia.id, categoryId: cats['Alimentación'] }, users.beto!).expect(404)).body.error).toBe('ACCOUNT_NOT_FOUND');

    // Cuenta de otro grupo
    const other = await setupFamily(['caro']);
    const foreign = (await other.users.caro!.agent.post(`/api/families/${other.familyId}/accounts`).send({ kind: 'bank', name: 'X', prefix: 'X' }).expect(201)).body.account;
    expect((await pay({ accountId: foreign.id, categoryId: cats['Alimentación'] }).expect(404)).body.error).toBe('ACCOUNT_NOT_FOUND');
    // Categoría de otro grupo
    const foreignCat = ((await other.users.caro!.agent.get(`/api/families/${other.familyId}/categories`)).body.categories as { id: string }[])[0]!.id;
    expect((await pay({ accountId: nu.id, categoryId: foreignCat }).expect(400)).body.error).toBe('CATEGORY_NOT_FOUND');

    const todo = await createList(users.ana!, familyId, { type: 'todo' });
    expect((await users.ana!.agent.get(`/api/lists/${todo.id}/payments`).expect(400)).body.error).toBe('PURCHASES_DISABLED');

    await users.ana!.agent.post(`/api/lists/${list.id}/archive`).expect(200);
    expect((await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(403)).body.error).toBe('LIST_ARCHIVED');
  });

  it('un grupo que nunca abrió finanzas ya tiene categorías para elegir', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const list = await createList(users.ana!, familyId);
    const p = (await users.ana!.agent.get(`/api/lists/${list.id}/payments`).expect(200)).body;
    expect(p.categories.map((c: { name: string }) => c.name)).toContain('Alimentación');
  });

  it('en inglés la descripción va en inglés', async () => {
    const { nu, cats, users, add, buy, pay, movements } = await setup();
    await users.ana!.agent.patch('/api/me').send({ locale: 'en' }).expect(200);
    const a = await add('A');
    await buy(a.id, 1);
    await pay({ accountId: nu.id, categoryId: cats['Alimentación'] }).expect(201);
    await settleBackground();
    expect((await movements())[0]!.description).toBe('Súper · 1 item');
  });
});
