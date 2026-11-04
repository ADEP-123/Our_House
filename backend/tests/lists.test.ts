import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { createList, createUser, resetDb, setupFamily, type User } from './helpers.js';

const names = async (user: User, familyId: string, archived = false) =>
  ((await user.agent.get(`/api/families/${familyId}/lists${archived ? '?archived=true' : ''}`).expect(200)).body.lists as {
    name: string;
  }[]).map((l) => l.name);

describe('listas: visibilidad y permisos', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('las listas del grupo las ven todos; las privadas solo quien las creó (tampoco los líderes)', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await createList(users.beto!, familyId, { name: 'Del grupo' });
    const priv = await createList(users.beto!, familyId, { name: 'Secreta', isPrivate: true });

    expect(await names(users.ana!, familyId)).toEqual(['Del grupo']);
    expect((await names(users.beto!, familyId)).sort()).toEqual(['Del grupo', 'Secreta']);
    await users.ana!.agent.get(`/api/lists/${priv.id}`).expect(404);
    await users.ana!.agent.get(`/api/lists/${priv.id}?supervision=true`).expect(404);
  });

  it('un miembro solo edita las suyas; un líder edita cualquiera del grupo; la privacidad solo la cambia quien la creó', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'caro']);
    const deBeto = await createList(users.beto!, familyId);

    await users.caro!.agent.patch(`/api/lists/${deBeto.id}`).send({ name: 'Mía' }).expect(403, { error: 'LIST_READ_ONLY' });
    const asCaro = await users.caro!.agent.get(`/api/lists/${deBeto.id}`).expect(200);
    expect(asCaro.body.list.permissions).toMatchObject({ canEdit: false, canCheck: true });

    const renamed = await users.ana!.agent.patch(`/api/lists/${deBeto.id}`).send({ name: 'Súper', color: 'green', icon: 'food' }).expect(200);
    expect(renamed.body.list).toMatchObject({ name: 'Súper', color: 'green', icon: 'food' });
    await users.ana!.agent.patch(`/api/lists/${deBeto.id}`).send({ isPrivate: true }).expect(403, { error: 'ONLY_CREATOR_CHANGES_PRIVACY' });
    await users.beto!.agent.patch(`/api/lists/${deBeto.id}`).send({ isPrivate: true }).expect(200);
    await users.ana!.agent.get(`/api/lists/${deBeto.id}`).expect(404);

    await users.ana!.agent.patch(`/api/lists/${deBeto.id}`).send({ name: 'Otra' }).expect(404); // ya no la ve
    await users.beto!.agent.patch(`/api/lists/${deBeto.id}`).send({ color: 'neon' }).expect(400);
  });

  it('un líder ve las privadas de un supervisado solo tras confirmar, y en modo lectura', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'nico'], ['nico']);
    const priv = await createList(users.nico!, familyId, { name: 'Diario de Nico', isPrivate: true });

    const leaderView = (await users.ana!.agent.get(`/api/families/${familyId}/lists`).expect(200)).body;
    expect(leaderView.lists).toEqual([]);
    expect(leaderView.supervisedPrivate).toEqual([{ id: priv.id, ownerNickname: 'nico' }]); // sin el nombre
    expect((await users.beto!.agent.get(`/api/families/${familyId}/lists`)).body.supervisedPrivate).toEqual([]);

    await users.ana!.agent.get(`/api/lists/${priv.id}`).expect(403, { error: 'SUPERVISION_CONFIRMATION_REQUIRED' });
    const seen = await users.ana!.agent.get(`/api/lists/${priv.id}?supervision=true`).expect(200);
    expect(seen.body.list).toMatchObject({ name: 'Diario de Nico', permissions: { canEdit: false, canCheck: false, supervision: true } });
    await users.ana!.agent.patch(`/api/lists/${priv.id}`).send({ name: 'x' }).expect(403);
    await users.ana!.agent.post(`/api/lists/${priv.id}/archive`).expect(403);
    await users.beto!.agent.get(`/api/lists/${priv.id}?supervision=true`).expect(404);
  });

  it('quien no es del grupo no ve nada', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const list = await createList(users.ana!, familyId);
    const zoe = await createUser('zoe');
    await zoe.agent.get(`/api/families/${familyId}/lists`).expect(404);
    await zoe.agent.get(`/api/lists/${list.id}`).expect(404);
    await zoe.agent.get('/api/lists/no-es-id').expect(404);
  });
});

describe('listas: archivar, purgar, fijar y duplicar', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('archiva, restaura y solo borra definitivamente las archivadas', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.beto!, familyId);

    await users.beto!.agent.delete(`/api/lists/${list.id}`).expect(409, { error: 'LIST_NOT_ARCHIVED' });
    const archived = await users.beto!.agent.post(`/api/lists/${list.id}/archive`).expect(200);
    expect(archived.body.list.permissions.canEdit).toBe(false);
    const days = (new Date(archived.body.list.purgeAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(15);

    expect(await names(users.ana!, familyId)).toEqual([]);
    expect(await names(users.ana!, familyId, true)).toEqual(['Compras']);
    await users.beto!.agent.patch(`/api/lists/${list.id}`).send({ name: 'x' }).expect(403, { error: 'LIST_ARCHIVED' });

    await users.ana!.agent.post(`/api/lists/${list.id}/restore`).expect(200); // un líder también puede
    expect(await names(users.beto!, familyId)).toEqual(['Compras']);

    await users.beto!.agent.post(`/api/lists/${list.id}/archive`).expect(200);
    await users.beto!.agent.delete(`/api/lists/${list.id}`).expect(204);
    expect(await names(users.beto!, familyId, true)).toEqual([]);
  });

  it('borra solas las archivadas con más de 15 días', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const vieja = await createList(users.ana!, familyId, { name: 'Vieja' });
    const nueva = await createList(users.ana!, familyId, { name: 'Nueva' });
    await users.ana!.agent.post(`/api/lists/${vieja.id}/archive`).expect(200);
    await users.ana!.agent.post(`/api/lists/${nueva.id}/archive`).expect(200);
    await db().query("UPDATE lists SET archived_at = now() - interval '16 days' WHERE id = $1", [vieja.id]);

    expect(await names(users.ana!, familyId, true)).toEqual(['Nueva']);
    expect((await db().query('SELECT count(*)::int AS n FROM lists WHERE id = $1', [vieja.id])).rows[0].n).toBe(0);
  });

  it('fijar es personal y las fijadas salen primero', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const a = await createList(users.ana!, familyId, { name: 'A' });
    await createList(users.ana!, familyId, { name: 'B' });
    await users.beto!.agent.put(`/api/lists/${a.id}/pin`).send({ pinned: true }).expect(200);
    expect(await names(users.beto!, familyId)).toEqual(['A', 'B']);
    expect(await names(users.ana!, familyId)).toEqual(['B', 'A']); // la más reciente primero
  });

  it('duplica con los ítems sin marcar; el duplicado es de quien lo crea', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const source = await createList(users.ana!, familyId, { name: 'Semana', color: 'teal', icon: 'cart' });
    await db().query(
      `INSERT INTO list_items (list_id, text, position, completed_at) VALUES ($1, 'Leche', 1, now()), ($1, 'Pan', 2, NULL)`,
      [source.id],
    );
    const copy = await users.beto!.agent.post(`/api/lists/${source.id}/duplicate`).send({ name: 'Semana 2' }).expect(201);
    expect(copy.body.list).toMatchObject({
      name: 'Semana 2',
      type: 'shopping',
      color: 'teal',
      icon: 'cart',
      isPrivate: false,
      createdBy: { nickname: 'beto' },
      counts: { total: 2, completed: 0, pending: 2 },
      permissions: { canEdit: true },
    });
    expect(copy.body.list.items.map((i: { text: string }) => i.text)).toEqual(['Leche', 'Pan']);
  });

  it('crear con un id del cliente es idempotente; ese id no lo puede usar otra persona', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const id = randomUUID();
    await createList(users.ana!, familyId, { id, name: 'Offline' });
    await createList(users.ana!, familyId, { id, name: 'Offline' });
    expect(await names(users.ana!, familyId)).toEqual(['Offline']);
    await users.beto!.agent.post(`/api/families/${familyId}/lists`).send({ id, name: 'Robo', type: 'todo' }).expect(409);
  });

  it('al salir del grupo se borran sus listas privadas y se quedan las del grupo', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await createList(users.beto!, familyId, { name: 'Pública' });
    await createList(users.beto!, familyId, { name: 'Privada', isPrivate: true });
    await users.beto!.agent.post(`/api/families/${familyId}/leave`).expect(204);
    expect((await db().query('SELECT name FROM lists')).rows.map((r) => r.name)).toEqual(['Pública']);
    const asAna = await users.ana!.agent.get(`/api/families/${familyId}/lists`).expect(200);
    expect(asAna.body.lists[0]).toMatchObject({ name: 'Pública', permissions: { canEdit: true } });
  });
});
