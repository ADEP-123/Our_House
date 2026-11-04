import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { createList, resetDb, setupFamily } from './helpers.js';

describe('compras parciales', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.ana!, familyId, { name: 'Súper' });
    const leche = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Leche', amount: 2, unit: 'L' }).expect(201)).body.item;
    const buy = (who: 'ana' | 'beto', body: Record<string, unknown>, itemId = leche.id) =>
      users[who]!.agent.post(`/api/lists/${list.id}/items/${itemId}/purchases`).send({ id: randomUUID(), ...body });
    return { familyId, users, list, leche, buy };
  }

  it('suma compras: parcial hasta alcanzar lo pedido, con lo pagado acumulado', async () => {
    const { list, users, buy, leche } = await setup();

    const partial = (await buy('beto', { amount: 1, spent: 1.5 }).expect(200)).body.item;
    expect(partial).toMatchObject({ amount: 2, unit: 'L', purchased: 1, spent: 1.5, completedAt: null });

    const done = (await buy('beto', { amount: 1, spent: 1.25 }).expect(200)).body.item;
    expect(done).toMatchObject({ purchased: 2, spent: 2.75, completedBy: { nickname: 'beto' } });
    expect(done.completedAt).not.toBeNull();

    // La tarjeta: el parcial cuenta como pendiente y muestra el total gastado del grupo en su moneda
    const card = (await users.ana!.agent.get(`/api/lists/${list.id}`)).body.list;
    expect(card).toMatchObject({ spent: 2.75, currency: 'USD', counts: { total: 1, completed: 1, pending: 0 } });

    // Desmarcar borra lo comprado
    const reset = (await users.ana!.agent.put(`/api/lists/${list.id}/items/${leche.id}/completed`).send({ completed: false }).expect(200)).body.item;
    expect(reset).toMatchObject({ purchased: null, spent: null, completedAt: null });
  });

  it('sin cantidad compra lo que falta; comprar de más cuenta como completo', async () => {
    const { buy } = await setup();
    await buy('ana', { amount: 0.5 }).expect(200);
    const rest = (await buy('ana', {}).expect(200)).body.item;
    expect(rest).toMatchObject({ purchased: 2 });
    expect(rest.completedAt).not.toBeNull();
  });

  it('una compra reenviada (mismo id) no se suma dos veces', async () => {
    const { buy } = await setup();
    const id = randomUUID();
    await buy('ana', { id, amount: 1 }).expect(200);
    const again = (await buy('ana', { id, amount: 1 }).expect(200)).body.item;
    expect(again.purchased).toBe(1);

    const { rows } = await db().query("SELECT count(*)::int AS n FROM activity_log WHERE action = 'item.purchased'");
    expect(rows[0].n).toBe(1);
  });

  it('cambiar la cantidad pedida recalcula si está completo', async () => {
    const { buy, list, users, leche } = await setup();
    await buy('ana', { amount: 2 }).expect(200);
    const more = (await users.ana!.agent.patch(`/api/lists/${list.id}/items/${leche.id}`).send({ amount: 3 }).expect(200)).body.item;
    expect(more).toMatchObject({ purchased: 2, completedAt: null });
    const less = (await users.ana!.agent.patch(`/api/lists/${list.id}/items/${leche.id}`).send({ amount: 2 }).expect(200)).body.item;
    expect(less.completedAt).not.toBeNull();
  });

  it('ítems sin cantidad: la compra los completa y guarda lo pagado', async () => {
    const { buy, list, users } = await setup();
    const pan = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Pan' }).expect(201)).body.item;
    const bought = (await buy('beto', { spent: 3 }, pan.id).expect(200)).body.item;
    expect(bought.spent).toBe(3);
    expect(bought.completedAt).not.toBeNull();
  });

  it('valida montos, el tipo de lista y la moneda del grupo', async () => {
    const { buy, users, familyId } = await setup();
    await buy('ana', { amount: 0 }).expect(400);
    await buy('ana', { amount: -1 }).expect(400);
    await buy('ana', { spent: -2 }).expect(400);
    await buy('ana', { amount: '1' }).expect(400);

    const todo = await createList(users.ana!, familyId, { type: 'todo' });
    const task = (await users.ana!.agent.post(`/api/lists/${todo.id}/items`).send({ text: 'x' }).expect(201)).body.item;
    await users.ana!.agent
      .post(`/api/lists/${todo.id}/items/${task.id}/purchases`)
      .send({ id: randomUUID() })
      .expect(400, { error: 'NOT_A_SHOPPING_LIST' });

    const updated = await users.ana!.agent.patch(`/api/families/${familyId}`).send({ currency: 'COP' }).expect(200);
    expect(updated.body.family.currency).toBe('COP');
    await users.ana!.agent.patch(`/api/families/${familyId}`).send({ currency: 'pesos' }).expect(400);
    await users.beto!.agent.patch(`/api/families/${familyId}`).send({ currency: 'EUR' }).expect(403);
  });
});
