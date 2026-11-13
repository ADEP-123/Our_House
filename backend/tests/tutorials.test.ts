import { beforeEach, describe, expect, it } from 'vitest';
import { api, createUser, resetDb } from './helpers.js';

describe('tutoriales', () => {
  beforeEach(resetDb);

  it('guarda cuáles se vieron, saltaron o en qué paso quedaron, sin tocar los demás', async () => {
    const { agent } = await createUser('ana');
    expect((await agent.get('/api/auth/me')).body.user.tutorials).toEqual({});

    await agent.put('/api/me/tutorials/lists').send({ state: 'progress', step: 3 }).expect(200);
    const res = await agent.put('/api/me/tutorials/account').send({ state: 'skipped' }).expect(200);
    expect(res.body.user.tutorials).toEqual({ lists: { state: 'progress', step: 3 }, account: { state: 'skipped' } });

    await agent.put('/api/me/tutorials/lists').send({ state: 'done' }).expect(200);
    expect((await agent.get('/api/auth/me')).body.user.tutorials.lists).toEqual({ state: 'done' });
  });

  it('solo tutoriales y estados conocidos, con sesión', async () => {
    const { agent } = await createUser('ana');
    await agent.put('/api/me/tutorials/finanzas').send({ state: 'done' }).expect(400);
    await agent.put('/api/me/tutorials/lists').send({ state: 'visto' }).expect(400);
    await agent.put('/api/me/tutorials/lists').send({ state: 'progress', step: -1 }).expect(400);
    await api().put('/api/me/tutorials/lists').send({ state: 'done' }).expect(401);
  });
});
