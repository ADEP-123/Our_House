import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createList, resetDb, setupFamily } from './helpers.js';

describe('opciones de las listas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('cada tipo nace con sus opciones; "Otra" sin ninguna salvo las elegidas', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    expect((await createList(users.ana!, familyId, { type: 'shopping' })).features).toEqual(['quantity', 'category', 'purchases', 'repeat']);
    expect((await createList(users.ana!, familyId, { type: 'todo' })).features).toEqual(['assignee', 'due', 'subtasks', 'repeat']);
    expect((await createList(users.ana!, familyId, { type: 'other' })).features).toEqual([]);
    const mixed = await createList(users.ana!, familyId, { type: 'other', features: ['quantity', 'assignee', 'due', 'quantity'] });
    expect(mixed.features).toEqual(['quantity', 'assignee', 'due']);
    await users.ana!.agent.post(`/api/families/${familyId}/lists`).send({ name: 'x', type: 'other', features: ['magia'] }).expect(400);
  });

  it('las opciones habilitan compras, subtareas, Mis tareas y se pueden cambiar después', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const me = users.ana!.user.id;
    const list = await createList(users.ana!, familyId, { name: 'Viaje', type: 'other', features: ['purchases', 'subtasks', 'assignee'] });
    const add = (body: Record<string, unknown>) => users.ana!.agent.post(`/api/lists/${list.id}/items`).send(body);

    const maleta = (await add({ text: 'Maleta', assigneeId: me }).expect(201)).body.item;
    await add({ text: 'Candado', parentId: maleta.id }).expect(201);
    await users.ana!.agent.post(`/api/lists/${list.id}/items/${maleta.id}/purchases`).send({ id: randomUUID(), spent: 40 }).expect(200);
    expect((await users.ana!.agent.get('/api/me/tasks')).body.tasks).toEqual([]); // ya está comprada (completa)

    const pasaje = (await add({ text: 'Pasaje', assigneeId: me }).expect(201)).body.item;
    expect((await users.ana!.agent.get('/api/me/tasks')).body.tasks.map((t: { id: string }) => t.id)).toEqual([pasaje.id]);

    // Sin la opción "responsable" la tarea deja de aparecer en Mis tareas, pero el dato se conserva
    const edited = (await users.ana!.agent.patch(`/api/lists/${list.id}`).send({ features: ['purchases'] }).expect(200)).body.list;
    expect(edited.features).toEqual(['purchases']);
    expect((await users.ana!.agent.get('/api/me/tasks')).body.tasks).toEqual([]);
    await add({ text: 'Otra', parentId: maleta.id }).expect(400, { error: 'SUBTASKS_DISABLED' });
    const items = (await users.ana!.agent.get(`/api/lists/${list.id}`)).body.list.items;
    expect(items.find((i: { id: string }) => i.id === pasaje.id).assigneeId).toBe(me);
  });
});
