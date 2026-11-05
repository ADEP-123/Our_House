import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { settleBackground } from '../src/lib/background.js';
import { openItem, sealItem } from '../src/lib/vault.js';
import { createList, resetDb, setupFamily, type User } from './helpers.js';

type Mail = { sent: { to: string; content: { subject: string; text: string } }[] };

describe('listas secretas', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  /** Pide el código, lo lee del correo y desbloquea la lista */
  async function unlock(user: User, mail: Mail, listId: string, supervision = false) {
    await db().query("UPDATE verification_codes SET created_at = now() - interval '2 minutes'"); // sin esperar los 60 s
    await user.agent.post('/api/me/verification-codes').send({ purpose: 'secrets' }).expect(202);
    const code = mail.sent.filter((m) => m.to === user.email).at(-1)!.content.subject.slice(0, 6);
    return (await user.agent.post(`/api/lists/${listId}/unlock`).send({ code, supervision }).expect(200)).body.token as string;
  }

  async function setup() {
    const family = await setupFamily(['ana', 'beto', 'nico'], ['nico']);
    const list = await createList(family.users.ana!, family.familyId, { name: 'Streaming', type: 'secret', icon: 'lock' });
    const add = (who: string, title: string, fields: unknown[]) =>
      family.users[who]!.agent.post(`/api/lists/${list.id}/secret-items`).send({ title, fields });
    return { ...family, list, add };
  }

  const netflix = [
    { label: 'Usuario', kind: 'username', value: 'casa@correo.com' },
    { label: 'Contraseña', kind: 'password', value: 'S3creta!' },
  ];

  it('cifra cada elemento con su propia clave y lo ata a su lista y elemento', () => {
    const a = sealItem('l1', 'i1', 'hola');
    const b = sealItem('l1', 'i1', 'hola');
    expect(a).not.toBe(b); // salt y vector distintos cada vez
    expect(a).not.toContain('hola');
    expect(openItem('l1', 'i1', a)).toBe('hola');
    expect(() => openItem('l1', 'i2', a)).toThrow(); // copiado a otro elemento: no descifra
    expect(() => openItem('l2', 'i1', a)).toThrow();
  });

  it('sin código solo se ven los títulos; con código, los valores; la base de datos nunca los tiene en claro', async () => {
    const { users, list, add, mail } = await setup();
    const item = (await add('ana', 'Netflix', netflix).expect(201)).body.item;
    expect(item).toMatchObject({ title: 'Netflix', mine: true });

    const { rows } = await db().query('SELECT payload_enc FROM secret_items');
    expect(rows[0].payload_enc).not.toContain('S3creta');

    const detail = (await users.beto!.agent.get(`/api/lists/${list.id}`).expect(200)).body.list;
    expect(detail.secretItems).toEqual([expect.objectContaining({ title: 'Netflix', mine: false })]);
    expect(JSON.stringify(detail)).not.toContain('S3creta');
    expect(detail.counts.total).toBe(1);

    await users.beto!.agent.get(`/api/lists/${list.id}/secrets`).expect(401, { error: 'SECRETS_LOCKED' });
    const token = await unlock(users.beto!, mail, list.id);
    const revealed = (await users.beto!.agent.get(`/api/lists/${list.id}/secrets`).set('X-Unlock-Token', token).expect(200)).body;
    expect(revealed.items).toEqual([{ id: item.id, fields: netflix }]);
    const raw = await users.beto!.agent.get(`/api/lists/${list.id}/secrets`).set('X-Unlock-Token', token);
    expect(raw.headers['cache-control']).toBe('no-store');
    expect(revealed.token).toBeTruthy();

    // El permiso es de esa persona y de esa lista
    await users.ana!.agent.get(`/api/lists/${list.id}/secrets`).set('X-Unlock-Token', token).expect(401);
  });

  it('avisa por correo a quien tiene elementos cuando otro desbloquea, y lo registra en la bitácora', async () => {
    const { users, list, add, mail } = await setup();
    await add('ana', 'Netflix', netflix).expect(201);
    await unlock(users.beto!, mail, list.id);
    await settleBackground();
    expect(mail.sent.at(-1)).toMatchObject({ to: 'ana@test.com', content: { subject: 'beto vio la información secreta de «Streaming»' } });
    const { rows } = await db().query("SELECT action FROM activity_log WHERE action LIKE 'secret.%' ORDER BY created_at");
    expect(rows.map((r) => r.action)).toEqual(['secret.created', 'secret.viewed']);
  });

  it('solo quien creó el elemento lo edita o lo borra (ni los líderes); el borrado es definitivo', async () => {
    const { users, list, add, mail } = await setup();
    const item = (await add('ana', 'Netflix', netflix).expect(201)).body.item;
    const beto = await unlock(users.beto!, mail, list.id);
    await users.beto!.agent.patch(`/api/lists/${list.id}/secret-items/${item.id}`).set('X-Unlock-Token', beto).send({ title: 'x' }).expect(403, { error: 'SECRET_NOT_YOURS' });
    await users.beto!.agent.delete(`/api/lists/${list.id}/secret-items/${item.id}`).expect(403);

    // Editar requiere la lista desbloqueada
    await users.ana!.agent.patch(`/api/lists/${list.id}/secret-items/${item.id}`).send({ title: 'Netflix casa' }).expect(401);
    const ana = await unlock(users.ana!, mail, list.id);
    await users.ana!.agent
      .patch(`/api/lists/${list.id}/secret-items/${item.id}`)
      .set('X-Unlock-Token', ana)
      .send({ fields: [{ label: 'PIN', kind: 'pin', value: '1234' }] })
      .expect(200);
    const revealed = (await users.ana!.agent.get(`/api/lists/${list.id}/secrets`).set('X-Unlock-Token', ana)).body.items;
    expect(revealed[0].fields).toEqual([{ label: 'PIN', kind: 'pin', value: '1234' }]);

    await users.ana!.agent.delete(`/api/lists/${list.id}/secret-items/${item.id}`).expect(204);
    expect((await db().query('SELECT count(*)::int AS n FROM secret_items')).rows[0].n).toBe(0);
  });

  it('la lista se borra directo, solo su dueño, desbloqueada y si todos los elementos son suyos', async () => {
    const { users, list, add, mail, familyId } = await setup();
    await add('ana', 'Netflix', netflix).expect(201);
    await users.beto!.agent.post(`/api/lists/${list.id}/secret-items`).send({ title: 'x', fields: [] }).expect(403); // miembro: lista ajena
    await users.ana!.agent.patch(`/api/families/${familyId}/members/${users.beto!.user.id}`).send({ role: 'leader' }).expect(200);
    const beto = await add('beto', 'Spotify', netflix).expect(201); // como líder sí puede agregar en la lista del grupo
    await users.ana!.agent.post(`/api/lists/${list.id}/archive`).expect(400, { error: 'SECRET_LIST_NO_ARCHIVE' });
    await users.ana!.agent.post(`/api/lists/${list.id}/duplicate`).send({ name: 'x' }).expect(400);

    await users.ana!.agent.delete(`/api/lists/${list.id}`).expect(401, { error: 'SECRETS_LOCKED' });
    const ana = await unlock(users.ana!, mail, list.id);
    await users.ana!.agent.delete(`/api/lists/${list.id}`).set('X-Unlock-Token', ana).expect(409, { error: 'SECRET_LIST_HAS_OTHERS_ITEMS' });
    await users.beto!.agent.delete(`/api/lists/${list.id}`).expect(403, { error: 'SECRET_LIST_NOT_YOURS' });

    await users.beto!.agent.delete(`/api/lists/${list.id}/secret-items/${beto.body.item.id}`).expect(204);
    await users.ana!.agent.delete(`/api/lists/${list.id}`).set('X-Unlock-Token', ana).expect(204);
    expect((await db().query('SELECT count(*)::int AS n FROM secret_items')).rows[0].n).toBe(0);
  });

  it('los líderes ven la lista secreta privada de un supervisado tras el aviso y con código', async () => {
    const { users, familyId, mail } = await setup();
    const priv = await createList(users.nico!, familyId, { name: 'Mis claves', type: 'secret', isPrivate: true });
    await users.nico!.agent.post(`/api/lists/${priv.id}/secret-items`).send({ title: 'Juego', fields: netflix }).expect(201);
    await users.ana!.agent.post(`/api/lists/${priv.id}/unlock`).send({ code: '123456' }).expect(403, { error: 'SUPERVISION_CONFIRMATION_REQUIRED' });
    const token = await unlock(users.ana!, mail, priv.id, true);
    const res = await users.ana!.agent.get(`/api/lists/${priv.id}/secrets?supervision=true`).set('X-Unlock-Token', token).expect(200);
    expect(res.body.items[0].fields[1].value).toBe('S3creta!');
    // La privada de un miembro normal no la ve nadie más
    const otra = await createList(users.beto!, familyId, { type: 'secret', isPrivate: true });
    await users.ana!.agent.get(`/api/lists/${otra.id}`).expect(404);
  });

  it('valida los campos y no admite ítems comunes en una lista secreta', async () => {
    const { users, list, add } = await setup();
    await add('ana', '', netflix).expect(400);
    await add('ana', 'x', [{ label: 'a', kind: 'magia', value: 'b' }]).expect(400);
    await add('ana', 'x', Array.from({ length: 21 }, () => ({ label: 'a', kind: 'text', value: 'b' }))).expect(400);
    await users.ana!.agent.post(`/api/lists/${list.id}/items`).send({ text: 'x' }).expect(400, { error: 'NOT_FOR_SECRET_LISTS' });
  });
});
