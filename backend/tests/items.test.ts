import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { createList, resetDb, setupFamily } from './helpers.js';

type Item = { id: string; text: string; completedAt: string | null; completedBy: { nickname: string } | null; position: number };

describe('ítems de las listas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('agrega ítems al final, con campos de compras y de tareas', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.ana!, familyId);
    const a = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: ' Leche ', amount: 2, unit: 'L', category: 'Lácteos' }).expect(201)).body.item;
    const b = (await users.ana!.agent
      .post(`/api/lists/${list.id}/items`)
      .send({ text: 'Pagar luz', assigneeId: users.beto!.user.id, dueDate: '2026-11-20', description: '' })
      .expect(201)).body.item;
    expect(a).toMatchObject({ text: 'Leche', amount: 2, unit: 'L', category: 'Lácteos', completedAt: null });
    expect(b).toMatchObject({ assigneeId: users.beto!.user.id, dueDate: '2026-11-20', description: null });
    expect(b.position).toBeGreaterThan(a.position);

    const zoe = (await setupFamily(['zoe'])).users.zoe!;
    await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'x', assigneeId: zoe.user.id }).expect(400, { error: 'ASSIGNEE_NOT_MEMBER' });
    await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'x', dueDate: '20-11-2026' }).expect(400);
    await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: '   ' }).expect(400);
  });

  it('cualquier miembro marca y desmarca; queda quién y cuándo; marcar dos veces no cambia el autor', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'caro']);
    const list = await createList(users.ana!, familyId);
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Pan' }).expect(201)).body.item as Item;

    const done = (await users.beto!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: true }).expect(200)).body.item as Item;
    expect(done.completedBy?.nickname).toBe('beto');
    expect(done.completedAt).not.toBeNull();
    const again = (await users.caro!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: true }).expect(200)).body.item as Item;
    expect(again.completedBy?.nickname).toBe('beto');

    const undone = (await users.caro!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: false }).expect(200)).body.item as Item;
    expect(undone).toMatchObject({ completedAt: null, completedBy: null });

    const card = (await users.ana!.agent.get(`/api/families/${familyId}/lists`)).body.lists[0];
    expect(card.counts).toEqual({ total: 1, completed: 0, pending: 1 });
  });

  it('en listas ajenas un miembro no agrega, edita, reordena ni borra; el creador y los líderes sí', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'caro']);
    const list = await createList(users.beto!, familyId);
    const item = (await users.beto!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Pan' }).expect(201)).body.item as Item;

    await users.caro!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Mío' }).expect(403);
    await users.caro!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ text: 'Otro' }).expect(403);
    await users.caro!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ position: 0.5 }).expect(403);
    await users.caro!.agent.delete(`/api/lists/${list.id}/items/${item.id}`).expect(403);
    await users.caro!.agent.post(`/api/lists/${list.id}/reset`).expect(403);

    const edited = (await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ text: 'Pan integral', position: 0.5, amount: null }).expect(200)).body.item;
    expect(edited).toMatchObject({ text: 'Pan integral', position: 0.5, amount: null });
    await users.ana!.agent.delete(`/api/lists/${list.id}/items/${item.id}`).expect(204);
    await users.ana!.agent.delete(`/api/lists/${list.id}/items/${item.id}`).expect(204); // idempotente
  });

  it('el líder en modo supervisión no puede marcar; en archivadas nadie marca', async () => {
    const { familyId, users } = await setupFamily(['ana', 'nico'], ['nico']);
    const priv = await createList(users.nico!, familyId, { isPrivate: true });
    const item = (await users.nico!.agent.post(`/api/lists/${priv.id}/items`).send({ text: 'Tarea' }).expect(201)).body.item as Item;
    await users.ana!.agent.put(`/api/lists/${priv.id}/items/${item.id}/completed`).send({ completed: true }).expect(403);

    const pub = await createList(users.ana!, familyId);
    const it2 = (await users.ana!.agent.post(`/api/lists/${pub.id}/items`).send({ text: 'Pan' }).expect(201)).body.item as Item;
    await users.ana!.agent.post(`/api/lists/${pub.id}/archive`).expect(200);
    await users.nico!.agent.put(`/api/lists/${pub.id}/items/${it2.id}/completed`).send({ completed: true }).expect(403, { error: 'LIST_ARCHIVED' });
  });

  it('reiniciar desmarca todo y borrar completados elimina solo los tachados', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const list = await createList(users.ana!, familyId);
    const ids: string[] = [];
    for (const text of ['A', 'B', 'C']) ids.push((await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text })).body.item.id);
    for (const id of ids.slice(0, 2)) await users.ana!.agent.put(`/api/lists/${list.id}/items/${id}/completed`).send({ completed: true });

    const reset = (await users.ana!.agent.post(`/api/lists/${list.id}/reset`).expect(200)).body.list;
    expect(reset.counts).toEqual({ total: 3, completed: 0, pending: 3 });

    await users.ana!.agent.put(`/api/lists/${list.id}/items/${ids[2]}/completed`).send({ completed: true });
    const cleared = (await users.ana!.agent.post(`/api/lists/${list.id}/clear-completed`).expect(200)).body.list;
    expect(cleared.items.map((i: Item) => i.text)).toEqual(['A', 'B']);
  });

  it('crear con el mismo id dos veces no duplica; un id de otra lista se rechaza', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const l1 = await createList(users.ana!, familyId);
    const l2 = await createList(users.ana!, familyId);
    const id = randomUUID();
    await users.ana!.agent.post(`/api/lists/${l1.id}/items`).send({ id, text: 'Pan' }).expect(201);
    await users.ana!.agent.post(`/api/lists/${l1.id}/items`).send({ id, text: 'Pan' }).expect(201);
    expect((await db().query('SELECT count(*)::int AS n FROM list_items')).rows[0].n).toBe(1);
    await users.ana!.agent.post(`/api/lists/${l2.id}/items`).send({ id, text: 'Pan' }).expect(409);
    await users.ana!.agent.patch(`/api/lists/${l2.id}/items/${id}`).send({ text: 'x' }).expect(404);
  });
});
