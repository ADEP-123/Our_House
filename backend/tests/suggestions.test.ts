import { beforeEach, describe, expect, it } from 'vitest';
import { createList, resetDb, setupFamily } from './helpers.js';

describe('sugerencias para una lista nueva', () => {
  beforeEach(resetDb);

  it('lo que el grupo más agrega en ese tipo de lista, sin privadas, subtareas ni otros grupos', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const [ana, beto] = [users.ana!, users.beto!];
    const add = async (listId: string, body: Record<string, unknown>) =>
      (await ana.agent.post(`/api/lists/${listId}/items`).send(body).expect(201)).body.item;

    const super1 = await createList(ana, familyId, { type: 'shopping' });
    const super2 = await createList(beto, familyId, { type: 'shopping' });
    await add(super1.id, { text: 'Leche' });
    await add(super1.id, { text: 'Pan' });
    await beto.agent.post(`/api/lists/${super2.id}/items`).send({ text: ' leche ' }).expect(201);
    const mine = await createList(ana, familyId, { type: 'shopping', isPrivate: true });
    await add(mine.id, { text: 'Regalo sorpresa' });
    const todo = await createList(ana, familyId, { type: 'todo' });
    const task = await add(todo.id, { text: 'Lavar el carro' });
    await add(todo.id, { text: 'Comprar jabón', parentId: task.id });
    // Lo borrado también cuenta: es lo que el grupo suele comprar
    await ana.agent.delete(`/api/lists/${super1.id}/items/${(await add(super1.id, { text: 'Café' })).id}`).expect(204);

    const other = await setupFamily(['caro']);
    const ajena = await createList(other.users.caro!, other.familyId, { type: 'shopping' });
    await other.users.caro!.agent.post(`/api/lists/${ajena.id}/items`).send({ text: 'Vino' }).expect(201);

    const shopping = (await beto.agent.get(`/api/families/${familyId}/lists/suggestions?type=shopping`).expect(200)).body.suggestions;
    expect(shopping[0]).toBe('leche');
    expect([...shopping].sort()).toEqual(['Café', 'Pan', 'leche']);
    expect((await ana.agent.get(`/api/families/${familyId}/lists/suggestions?type=todo`).expect(200)).body.suggestions).toEqual(['Lavar el carro']);

    await ana.agent.get(`/api/families/${familyId}/lists/suggestions?type=magia`).expect(400);
    await other.users.caro!.agent.get(`/api/families/${familyId}/lists/suggestions?type=shopping`).expect(404);
  });
});
