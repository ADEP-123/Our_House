import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleBackground } from '../src/lib/background.js';
import { createList, resetDb, setupFamily } from './helpers.js';

describe('notificaciones por correo', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  /** Correos enviados después de preparar el grupo (descarta los de registro) */
  async function after(mail: { sent: { to: string; content: { subject: string; text: string } }[] }, action: () => Promise<unknown>) {
    const before = mail.sent.length;
    await action();
    await settleBackground();
    return mail.sent.slice(before);
  }

  it('avisa a los demás al crear una lista del grupo, no al crear una privada', async () => {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto', 'nico'], ['nico']);
    const sent = await after(mail, () => createList(users.ana!, familyId, { name: 'Súper' }));
    expect(sent.map((m) => m.to).sort()).toEqual(['beto@test.com', 'nico@test.com']);
    expect(sent[0]!.content.subject).toBe('ana creó la lista «Súper» en Casa');
    expect(sent[0]!.content.text).toContain('/listas/');

    expect(await after(mail, () => createList(users.ana!, familyId, { name: 'Mía', isPrivate: true }))).toEqual([]);
  });

  it('avisa cuando una lista privada pasa a ser del grupo', async () => {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.ana!, familyId, { name: 'Regalo', isPrivate: true });
    const sent = await after(mail, () => users.ana!.agent.patch(`/api/lists/${list.id}`).send({ isPrivate: false }).expect(200));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'beto@test.com', content: { subject: 'ana compartió la lista «Regalo» en Casa' } });
  });

  it('respeta la preferencia de cada persona', async () => {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto']);
    const res = await users.beto!.agent.patch('/api/me/settings').send({ newLists: false }).expect(200);
    expect(res.body.user.notifications).toEqual({ newLists: false, assignments: true, reminders: true });
    expect(await after(mail, () => createList(users.ana!, familyId))).toEqual([]);

    await users.beto!.agent.patch('/api/me/settings').send({}).expect(400);
    await users.beto!.agent.patch('/api/me/settings').send({ newLists: 'no' }).expect(400);
    await users.beto!.agent.patch('/api/me/settings').send({ otra: true }).expect(400);
  });

  it('avisa al asignar una tarea a otra persona, no al asignársela uno mismo', async () => {
    const { familyId, users, mail } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.ana!, familyId, { name: 'Casa', type: 'todo' });
    const beto = users.beto!.user.id;

    let sent = await after(mail, () =>
      users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Pagar luz', assigneeId: beto, dueDate: '2026-11-20' }).expect(201),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content.subject).toBe('ana te asignó «Pagar luz»');
    expect(sent[0]!.content.text).toContain('viernes, 20 de noviembre');

    // Editar sin cambiar el responsable no reenvía
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Barrer' }).expect(201)).body.item;
    sent = await after(mail, () => users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ text: 'Barrer patio' }).expect(200));
    expect(sent).toEqual([]);

    const own = await createList(users.beto!, familyId, { type: 'todo' });
    await settleBackground();
    sent = await after(mail, () => users.beto!.agent.post(`/api/lists/${own.id}/items`).send({ text: 'Mía', assigneeId: beto }).expect(201));
    expect(sent.map((m) => m.content.subject)).toEqual([]);

    await users.beto!.agent.patch('/api/me/settings').send({ assignments: false }).expect(200);
    sent = await after(mail, () => users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ assigneeId: beto }).expect(200));
    expect(sent).toEqual([]);
  });
});
