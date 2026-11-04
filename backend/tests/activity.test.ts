import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { createList, resetDb, setupFamily, type User } from './helpers.js';

type Entry = {
  action: string;
  actor: { nickname: string } | null;
  list: { name: string | null; private: boolean } | null;
  item: { text: string | null } | null;
  details: Record<string, unknown> | null;
  hidden: boolean;
};

const log = async (user: User, familyId: string, query = '') =>
  (await user.agent.get(`/api/families/${familyId}/activity${query}`).expect(200)).body as { entries: Entry[]; nextCursor: string | null };

const summary = (entries: Entry[]) => entries.map((e) => `${e.actor?.nickname ?? 'sistema'} ${e.action} ${e.list?.name ?? '-'} ${e.item?.text ?? ''}`.trim());

describe('bitácora', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('registra cada acción sobre listas e ítems, de la más reciente a la más antigua', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const list = await createList(users.ana!, familyId, { name: 'Súper' });
    const item = (await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'Leche' })).body.item;
    await users.beto!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: true });
    await users.beto!.agent.put(`/api/lists/${list.id}/items/${item.id}/completed`).send({ completed: true }); // sin cambio: no registra
    await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ text: 'Leche descremada' });
    await users.ana!.agent.patch(`/api/lists/${list.id}/items/${item.id}`).send({ position: 9 });
    await users.ana!.agent.post(`/api/lists/${list.id}/reset`);
    await users.ana!.agent.patch(`/api/lists/${list.id}`).send({ name: 'Súper sábado' });
    await users.ana!.agent.delete(`/api/lists/${list.id}/items/${item.id}`);
    await users.ana!.agent.post(`/api/lists/${list.id}/archive`);
    await users.ana!.agent.post(`/api/lists/${list.id}/restore`);

    const { entries } = await log(users.ana!, familyId);
    expect(summary(entries)).toEqual([
      'ana list.restored Súper sábado',
      'ana list.archived Súper sábado',
      'ana item.deleted Súper sábado Leche descremada',
      'ana list.updated Súper sábado',
      'ana list.reset Súper',
      'ana item.moved Súper Leche descremada',
      'ana item.updated Súper Leche descremada',
      'beto item.completed Súper Leche',
      'ana item.created Súper Leche',
      'ana list.created Súper',
    ]);
    expect(entries.find((e) => e.action === 'list.updated')!.details).toEqual({ changes: { name: { from: 'Súper', to: 'Súper sábado' } } });
    expect(entries.find((e) => e.action === 'item.updated')!.details).toEqual({ fields: ['text'], previousText: 'Leche' });
    expect(entries.find((e) => e.action === 'list.reset')!.details).toEqual({ count: 1 });
  });

  it('solo los líderes la ven, con filtros por lista, persona y fecha, y paginada', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    const a = await createList(users.ana!, familyId, { name: 'A' });
    const b = await createList(users.beto!, familyId, { name: 'B' });
    for (let i = 0; i < 3; i++) await users.beto!.agent.post(`/api/lists/${b.id}/items`).send({ text: `x${i}` });

    await users.beto!.agent.get(`/api/families/${familyId}/activity`).expect(403, { error: 'NOT_LEADER' });

    expect(summary((await log(users.ana!, familyId, `?listId=${a.id}`)).entries)).toEqual(['ana list.created A']);
    expect((await log(users.ana!, familyId, `?actorId=${users.beto!.user.id}`)).entries).toHaveLength(4);
    expect((await log(users.ana!, familyId, '?from=2000-01-01&to=2000-01-02')).entries).toEqual([]);

    const page1 = await log(users.ana!, familyId, '?limit=3');
    expect(page1.entries).toHaveLength(3);
    const page2 = await log(users.ana!, familyId, `?limit=3&before=${page1.nextCursor}`);
    expect(page2.entries).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const filters = (await users.ana!.agent.get(`/api/families/${familyId}/activity/filters`).expect(200)).body;
    expect(filters.lists.map((l: { name: string }) => l.name).sort()).toEqual(['A', 'B']);
    expect(filters.actors.map((x: { nickname: string }) => x.nickname).sort()).toEqual(['ana', 'beto']);
  });

  it('oculta el contenido de las privadas de miembros normales; muestra las de supervisados y la consulta del líder', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'nico'], ['nico']);
    const secret = await createList(users.beto!, familyId, { name: 'Regalo sorpresa', isPrivate: true });
    await users.beto!.agent.post(`/api/lists/${secret.id}/items`).send({ text: 'Reloj' });
    const kid = await createList(users.nico!, familyId, { name: 'Diario', isPrivate: true });

    // Ver con supervisión queda registrado una sola vez aunque se refresque
    await users.ana!.agent.get(`/api/lists/${kid.id}?supervision=true`).expect(200);
    await users.ana!.agent.get(`/api/lists/${kid.id}?supervision=true`).expect(200);

    const { entries } = await log(users.ana!, familyId);
    const betoEntries = entries.filter((e) => e.actor?.nickname === 'beto');
    expect(betoEntries.every((e) => e.hidden && e.list?.name === null && (e.item === null || e.item.text === null))).toBe(true);
    expect(betoEntries.map((e) => e.action)).toEqual(['item.created', 'list.created']);

    expect(summary(entries.filter((e) => e.actor?.nickname !== 'beto'))).toEqual([
      'ana list.viewed_private Diario',
      'nico list.created Diario',
    ]);
    const filters = (await users.ana!.agent.get(`/api/families/${familyId}/activity/filters`)).body;
    expect(filters.lists.map((l: { name: string | null }) => l.name).sort()).toEqual(['Diario', null]);
  });

  it('los registros sobreviven al borrado de la lista y la purga automática queda como acción del sistema', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const list = await createList(users.ana!, familyId, { name: 'Vieja' });
    await users.ana!.agent.post(`/api/lists/${list.id}/archive`);
    await db().query("UPDATE lists SET archived_at = now() - interval '20 days'");
    await users.ana!.agent.get(`/api/families/${familyId}/lists`).expect(200); // dispara la purga

    const { entries } = await log(users.ana!, familyId);
    expect(summary(entries)).toEqual(['sistema list.purged Vieja', 'ana list.archived Vieja', 'ana list.created Vieja']);
    expect(entries[0]!.details).toEqual({ days: 15 });
  });
});
