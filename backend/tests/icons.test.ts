import { beforeEach, describe, expect, it } from 'vitest';
import { isSingleEmoji } from '../src/lib/lists.js';
import { createList, resetDb, setupFamily } from './helpers.js';

describe('íconos de las listas', () => {
  beforeEach(resetDb);

  it('acepta un solo emoji, con tono de piel, bandera o combinado', () => {
    for (const ok of ['🦄', '👍🏽', '🇨🇴', '👨‍👩‍👧', '❤️', '1️⃣', '🏳️‍🌈']) expect(isSingleEmoji(ok)).toBe(true);
    for (const bad of ['', 'a', '12', '🦄🦄', 'casa', '<b>', ' ']) expect(isSingleEmoji(bad)).toBe(false);
  });

  it('se guarda un ícono con nombre o cualquier emoji; texto no', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const ana = users.ana!;
    expect((await createList(ana, familyId, { icon: 'broom' })).icon).toBe('broom');
    const list = await createList(ana, familyId, { icon: '🦄' });
    expect(list.icon).toBe('🦄');
    expect((await ana.agent.patch(`/api/lists/${list.id}`).send({ icon: '🇨🇴' }).expect(200)).body.list.icon).toBe('🇨🇴');
    await ana.agent.patch(`/api/lists/${list.id}`).send({ icon: 'unicornio' }).expect(400, { error: 'VALIDATION', fields: { icon: 'ICON_INVALID' } });
    await ana.agent.post(`/api/families/${familyId}/lists`).send({ name: 'x', type: 'todo', icon: '🦄🦄' }).expect(400);
  });
});
