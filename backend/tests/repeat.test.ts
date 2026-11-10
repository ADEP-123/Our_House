import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { settleBackground } from '../src/lib/background.js';
import { api, createList, resetDb, setupFamily, type User } from './helpers.js';

const add = async (user: User, listId: string, body: Record<string, unknown>) =>
  (await user.agent.post(`/api/lists/${listId}/items`).send(body).expect(201)).body.item;
const complete = async (user: User, listId: string, itemId: string, completed = true) =>
  (await user.agent.put(`/api/lists/${listId}/items/${itemId}/completed`).send({ completed }).expect(200)).body.item;

describe('tareas que se repiten', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('al completarla pasa a la siguiente fecha, pendiente y con las subtareas desmarcadas', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const ana = users.ana!;
    const list = await createList(ana, familyId, { type: 'todo' });
    expect(list.features).toContain('repeat');
    const item = await add(ana, list.id, {
      text: 'Regar plantas',
      dueDate: '2030-03-04',
      repeat: { freq: 'weekly', weekdays: [1, 4] },
    });
    expect(item.repeat).toMatchObject({
      freq: 'weekly',
      interval: 1,
      weekdays: [1, 4],
      from: 'schedule',
      start: '2030-03-04',
    });
    const sub = await add(ana, list.id, {
      text: 'Las del balcón',
      parentId: item.id,
    });
    await complete(ana, list.id, sub.id);

    // La subtarea completa a la tarea, y la tarea pasa al jueves
    const detail = (await ana.agent.get(`/api/lists/${list.id}`).expect(200)).body.list;
    const rolled = detail.items.find((i: { id: string }) => i.id === item.id);
    expect(rolled).toMatchObject({
      dueDate: '2030-03-07',
      completedAt: null,
      repeatDone: 1,
    });
    expect(detail.items.find((i: { id: string }) => i.id === sub.id).completedAt).toBeNull();

    // Saltar esta vez: pasa al lunes siguiente sin contar
    const skipped = (await ana.agent.post(`/api/lists/${list.id}/items/${item.id}/skip`).expect(200)).body.item;
    expect(skipped).toMatchObject({ dueDate: '2030-03-11', repeatDone: 1 });

    const activity = (await ana.agent.get(`/api/families/${familyId}/activity`).expect(200)).body.entries;
    expect(activity.map((e: { action: string }) => e.action)).toContain('item.skipped');
    expect(
      activity.find((e: { action: string; details: { bySubtasks?: boolean } }) => e.action === 'item.completed' && e.details?.bySubtasks).details
        .next,
    ).toBe('2030-03-07');
  });

  it('termina en una fecha o tras N veces; desde que se hizo cuenta a partir de hoy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-10T15:00:00Z'));
    const { familyId, users } = await setupFamily(['ana']);
    const ana = users.ana!;
    const list = await createList(ana, familyId, { type: 'todo' });

    const twice = await add(ana, list.id, {
      text: 'Vacuna',
      dueDate: '2030-05-01',
      repeat: { freq: 'monthly', count: 2 },
    });
    // Se hizo tarde (hoy es 10 de mayo): la siguiente se cuenta desde hoy
    expect(await complete(ana, list.id, twice.id)).toMatchObject({
      dueDate: '2030-06-01',
      completedAt: null,
    });
    expect((await complete(ana, list.id, twice.id)).completedAt).not.toBeNull();

    const until = await add(ana, list.id, {
      text: 'Riego',
      dueDate: '2030-05-20',
      repeat: { freq: 'daily', interval: 10, until: '2030-05-25' },
    });
    expect((await complete(ana, list.id, until.id)).completedAt).not.toBeNull();

    const filter = await add(ana, list.id, {
      text: 'Filtro',
      dueDate: '2030-05-12',
      repeat: { freq: 'daily', interval: 30, from: 'completion' },
    });
    expect(await complete(ana, list.id, filter.id)).toMatchObject({
      dueDate: '2030-06-09',
    });
  });

  it('los turnos pasan a la siguiente persona y le avisan', async () => {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto', 'caro']);
    const [ana, beto, caro] = [users.ana!, users.beto!, users.caro!];
    const list = await createList(ana, familyId, { type: 'todo' });
    const item = await add(ana, list.id, {
      text: 'Sacar la basura',
      dueDate: '2030-03-04',
      repeat: { freq: 'daily' },
      rotation: [beto.user.id, caro.user.id, ana.user.id],
    });
    expect(item).toMatchObject({
      assigneeId: beto.user.id,
      rotation: [beto.user.id, caro.user.id, ana.user.id],
    });

    await settleBackground();
    mail.sent.length = 0;
    expect(await complete(beto, list.id, item.id)).toMatchObject({
      dueDate: '2030-03-05',
      assigneeId: caro.user.id,
    });
    await settleBackground();
    expect(mail.sent.map((m) => m.to)).toEqual([caro.email]);
    // Saltar no cambia el turno
    expect((await beto.agent.post(`/api/lists/${list.id}/items/${item.id}/skip`).expect(200)).body.item.assigneeId).toBe(caro.user.id);

    const outsider = (await setupFamily(['dani'])).users.dani!;
    await ana.agent
      .patch(`/api/lists/${list.id}/items/${item.id}`)
      .send({ rotation: [outsider.user.id] })
      .expect(400);
  });

  it('en compras, lo que se repite sin fecha queda comprado hasta que vuelve a tocar', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const ana = users.ana!;
    const list = await createList(ana, familyId, { type: 'shopping' });
    const milk = await add(ana, list.id, {
      text: 'Leche',
      amount: 2,
      repeat: { freq: 'weekly' },
    });
    await ana.agent.post(`/api/lists/${list.id}/items/${milk.id}/purchases`).send({ id: crypto.randomUUID(), amount: 2 }).expect(200);

    let item = (await ana.agent.get(`/api/lists/${list.id}`).expect(200)).body.list.items[0];
    expect(item.completedAt).not.toBeNull();
    expect(item.reopenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Llega el día: vuelve a pendiente al abrir la lista
    await db().query('UPDATE list_items SET reopen_on = current_date WHERE id = $1', [milk.id]);
    item = (await ana.agent.get(`/api/lists/${list.id}`).expect(200)).body.list.items[0];
    expect(item).toMatchObject({
      completedAt: null,
      purchased: null,
      reopenOn: null,
      repeatDone: 1,
    });
  });

  it('solo en listas con la opción y con datos válidos', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const ana = users.ana!;
    const list = await createList(ana, familyId, {
      type: 'other',
      features: [],
    });
    await ana.agent
      .post(`/api/lists/${list.id}/items`)
      .send({ text: 'x', repeat: { freq: 'weekly' } })
      .expect(400, { error: 'REPEAT_DISABLED' });
    const todo = await createList(ana, familyId, { type: 'todo' });
    await ana.agent
      .post(`/api/lists/${todo.id}/items`)
      .send({ text: 'x', repeat: { freq: 'hourly' } })
      .expect(400);
    const once = await add(ana, todo.id, {
      text: 'Una vez',
      dueDate: '2030-01-01',
    });
    await ana.agent.post(`/api/lists/${todo.id}/items/${once.id}/skip`).expect(400, { error: 'NOT_REPEATING' });
    await api().post(`/api/lists/${todo.id}/items/${once.id}/skip`).expect(401);
  });
});
