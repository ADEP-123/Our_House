import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, createList, resetDb, setupFamily } from './helpers.js';

describe('fecha límite con hora y Mis tareas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('la hora se interpreta en la zona horaria de quien la pone', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await users.ana!.agent.patch('/api/me').send({ timezone: 'America/Los_Angeles' }).expect(200);
    const list = await createList(users.ana!, familyId, { type: 'todo' });
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Pagar luz', dueDate: '2026-11-20', dueTime: '18:30' }).expect(201)).body.item;
    // 18:30 en Los Ángeles (UTC-8 en noviembre) = 02:30 UTC del día siguiente
    expect(item).toMatchObject({ dueDate: '2026-11-20', dueTime: '18:30', dueAt: '2026-11-21T02:30:00.000Z' });

    const allDay = (await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ dueTime: null }).expect(200)).body.item;
    expect(allDay).toMatchObject({ dueDate: '2026-11-20', dueTime: null, dueAt: null });

    const none = (await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ dueTime: '09:00', dueDate: null }).expect(200)).body.item;
    expect(none).toMatchObject({ dueDate: null, dueTime: null });

    await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ dueTime: '09:00' }).expect(400, { error: 'DUE_TIME_NEEDS_DATE' });
    await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ dueDate: '2026-11-20', dueTime: '25:00' }).expect(400);
  });

  it('Mis tareas junta lo asignado en todos los grupos, sin completadas, archivadas ni privadas ajenas', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const beto = users.beto!.user.id;
    const casa = await createList(users.ana!, familyId, { name: 'Casa', type: 'todo' });
    const add = async (listId: string, body: Record<string, unknown>) =>
      (await users.ana!.agent.post(`/api/lists/${listId}/items`).send(body).expect(201)).body.item;

    const luz = await add(casa.id, { text: 'Pagar luz', assigneeId: beto, dueDate: '2026-11-20' });
    await add(casa.id, { text: 'Sin fecha', assigneeId: beto });
    const hecha = await add(casa.id, { text: 'Hecha', assigneeId: beto });
    await users.beto!.agent.put(`/api/lists/${casa.id}/items/${hecha.id}/completed`).send({ completed: true }).expect(200);
    await add(casa.id, { text: 'De ana', assigneeId: users.ana!.user.id });
    const sub = await add(casa.id, { text: 'Llamar', parentId: luz.id, assigneeId: beto, dueDate: '2026-11-18' });

    const archivada = await createList(users.ana!, familyId, { type: 'todo' });
    await add(archivada.id, { text: 'Archivada', assigneeId: beto });
    await users.ana!.agent.post(`/api/lists/${archivada.id}/archive`).expect(200);

    const tasks = (await users.beto!.agent.get('/api/me/tasks').expect(200)).body.tasks;
    expect(tasks.map((t: { text: string }) => t.text)).toEqual(['Llamar', 'Pagar luz', 'Sin fecha']);
    expect(tasks[0]).toMatchObject({ id: sub.id, parentText: 'Pagar luz', list: { id: casa.id, name: 'Casa' }, family: { id: familyId, name: 'Casa' } });
    await api().get('/api/me/tasks').expect(401);
  });
});
