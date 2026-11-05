import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { createList, resetDb, setupFamily } from './helpers.js';

type Item = { id: string; parentId: string | null; completedAt: string | null; text: string };

describe('subtareas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.ana!, familyId, { name: 'Casa', type: 'todo' });
    const ana = users.ana!.agent;
    const add = async (text: string, parentId?: string) =>
      (await ana.post(`/api/lists/${list.id}/items`).send({ text, parentId }).expect(201)).body.item as Item;
    const check = async (who: 'ana' | 'beto', id: string, completed: boolean) =>
      (await users[who]!.agent.put(`/api/lists/${list.id}/items/${id}/completed`).send({ completed }).expect(200)).body.item as Item;
    const items = async () => (await ana.get(`/api/lists/${list.id}`)).body.list as { items: Item[]; counts: Record<string, number> };
    const find = async (id: string) => (await items()).items.find((i) => i.id === id)!;
    return { familyId, users, list, ana, add, check, items, find };
  }

  it('la tarea se completa sola al terminar sus subtareas y vuelve a pendiente si una se desmarca', async () => {
    const { add, check, find, items } = await setup();
    const mudanza = await add('Mudanza');
    const cajas = await add('Comprar cajas', mudanza.id);
    const camion = await add('Reservar camión', mudanza.id);
    expect(cajas.parentId).toBe(mudanza.id);

    await check('beto', cajas.id, true);
    expect((await find(mudanza.id)).completedAt).toBeNull();
    await check('beto', camion.id, true);
    expect((await find(mudanza.id)).completedAt).not.toBeNull();

    await check('ana', camion.id, false);
    expect((await find(mudanza.id)).completedAt).toBeNull();

    // La tarjeta cuenta solo las tareas principales
    expect((await items()).counts).toEqual({ total: 1, completed: 0, pending: 1 });
  });

  it('completar la tarea completa sus subtareas; agregar una subtarea la reabre', async () => {
    const { add, check, find } = await setup();
    const viaje = await add('Viaje');
    const pasaportes = await add('Pasaportes', viaje.id);
    await check('ana', viaje.id, true);
    expect((await find(pasaportes.id)).completedAt).not.toBeNull();

    await add('Seguro', viaje.id);
    expect((await find(viaje.id)).completedAt).toBeNull();
  });

  it('un solo nivel, solo en listas de tareas y dentro de la misma lista', async () => {
    const { add, ana, list, users, familyId } = await setup();
    const a = await add('A');
    const b = await add('B', a.id);
    await ana.post(`/api/lists/${list.id}/items`).send({ text: 'C', parentId: b.id }).expect(400, { error: 'SUBTASK_TOO_DEEP' });

    const compras = await createList(users.ana!, familyId, { type: 'shopping' });
    await ana.post(`/api/lists/${compras.id}/items`).send({ text: 'x', parentId: a.id }).expect(400, { error: 'SUBTASKS_DISABLED' });

    const otra = await createList(users.ana!, familyId, { type: 'todo' });
    await ana.post(`/api/lists/${otra.id}/items`).send({ text: 'x', parentId: a.id }).expect(400, { error: 'PARENT_NOT_FOUND' });
  });

  it('borrar la tarea borra sus subtareas; borrar la última pendiente completa la tarea', async () => {
    const { add, check, ana, list, find, items } = await setup();
    const t = await add('T');
    const s1 = await add('S1', t.id);
    const s2 = await add('S2', t.id);
    await check('ana', s1.id, true);
    await ana.delete(`/api/lists/${list.id}/items/${s2.id}`).expect(204);
    expect((await find(t.id)).completedAt).not.toBeNull();

    await ana.delete(`/api/lists/${list.id}/items/${t.id}`).expect(204);
    expect((await items()).items).toEqual([]);
  });

  it('duplicar copia las subtareas debajo de su tarea', async () => {
    const { add, ana, list } = await setup();
    const t = await add('T');
    await add('S', t.id);
    const copy = (await ana.post(`/api/lists/${list.id}/duplicate`).send({ name: 'Copia' }).expect(201)).body.list;
    const items = (await ana.get(`/api/lists/${copy.id}`)).body.list.items as Item[];
    const parent = items.find((i) => i.text === 'T')!;
    expect(parent.id).not.toBe(t.id);
    expect(items.find((i) => i.text === 'S')!.parentId).toBe(parent.id);
  });

  it('la bitácora registra cuando la tarea se completa por sus subtareas', async () => {
    const { add, check } = await setup();
    const t = await add('T');
    const s = await add('S', t.id);
    await check('beto', s.id, true);
    const { rows } = await db().query("SELECT item_text, details FROM activity_log WHERE action = 'item.completed' ORDER BY created_at");
    expect(rows.map((r) => [r.item_text, r.details])).toEqual([
      ['S', null],
      ['T', { bySubtasks: true }],
    ]);
  });
});
