import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { api, captureMail, createUser, PASSWORD, resetDb } from './helpers.js';

type Agent = Awaited<ReturnType<typeof createUser>>['agent'];

async function createFamily(agent: Agent, name = 'Casa') {
  const res = await agent.post('/api/families').send({ name }).expect(201);
  return res.body.family.id as string;
}

async function membersOf(agent: Agent, familyId: string) {
  const res = await agent.get(`/api/families/${familyId}`).expect(200);
  return (res.body.family.members as { nickname: string; role: string }[]).map((m) => `${m.nickname}:${m.role}`).sort();
}

describe('grupos familiares', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('crea un grupo con quien lo crea como líder, y permite renombrarlo', async () => {
    const { agent } = await createUser('ana');
    const id = await createFamily(agent, '  Los Gómez  ');

    const list = await agent.get('/api/families').expect(200);
    expect(list.body.families).toEqual([
      expect.objectContaining({ id, name: 'Los Gómez', role: 'leader', memberCount: 1 }),
    ]);
    const detail = await agent.get(`/api/families/${id}`).expect(200);
    expect(detail.body.family.inviteCode).toMatch(/^[A-Z2-9]{8}$/);

    // El nombre no es único: otro grupo puede llamarse igual
    await createFamily(agent, 'Los Gómez');
    const renamed = await agent.patch(`/api/families/${id}`).send({ name: 'Casa de playa' }).expect(200);
    expect(renamed.body.family.name).toBe('Casa de playa');
    await agent.patch(`/api/families/${id}`).send({ name: '   ' }).expect(400);
  });

  it('quien no es miembro no ve el grupo y un miembro normal no puede administrarlo', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const id = await createFamily(ana.agent);

    await beto.agent.get(`/api/families/${id}`).expect(404, { error: 'FAMILY_NOT_FOUND' });
    await beto.agent.get('/api/families/no-es-un-id').expect(404);

    const code = (await ana.agent.get(`/api/families/${id}`)).body.family.inviteCode;
    await beto.agent.post('/api/families/join').send({ code: code.toLowerCase() }).expect(200);
    const asMember = await beto.agent.get(`/api/families/${id}`).expect(200);
    expect(asMember.body.family.inviteCode).toBeNull();

    await beto.agent.patch(`/api/families/${id}`).send({ name: 'Mía' }).expect(403, { error: 'NOT_LEADER' });
    await beto.agent.post(`/api/families/${id}/invitations`).send({ target: 'x@test.com' }).expect(403);
    await beto.agent.post('/api/families/join').send({ code }).expect(409, { error: 'ALREADY_MEMBER' });
  });

  it('regenerar el código invalida el anterior', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const id = await createFamily(ana.agent);
    const oldCode = (await ana.agent.get(`/api/families/${id}`)).body.family.inviteCode;

    const res = await ana.agent.post(`/api/families/${id}/invite-code`).expect(200);
    expect(res.body.inviteCode).not.toBe(oldCode);
    await beto.agent.post('/api/families/join').send({ code: oldCode }).expect(404, { error: 'INVITE_CODE_INVALID' });
    await beto.agent.post('/api/families/join').send({ code: res.body.inviteCode }).expect(200);
  });

  it('puede haber varios líderes, pero nunca cero', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const id = await createFamily(ana.agent);
    const code = (await ana.agent.get(`/api/families/${id}`)).body.family.inviteCode;
    await beto.agent.post('/api/families/join').send({ code }).expect(200);

    await ana.agent.patch(`/api/families/${id}/members/${ana.user.id}`).send({ role: 'member' }).expect(409, { error: 'LAST_LEADER' });
    await ana.agent.patch(`/api/families/${id}/members/${beto.user.id}`).send({ role: 'leader' }).expect(200);
    expect(await membersOf(ana.agent, id)).toEqual(['ana:leader', 'beto:leader']);

    // Con dos líderes, uno puede volver a ser miembro
    await ana.agent.patch(`/api/families/${id}/members/${ana.user.id}`).send({ role: 'member' }).expect(200);
    expect(await membersOf(beto.agent, id)).toEqual(['ana:member', 'beto:leader']);
  });

  it('si sale el último líder, el miembro más antiguo pasa a ser líder; sin miembros el grupo se elimina', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const caro = await createUser('caro', mail);
    const id = await createFamily(ana.agent);
    const code = (await ana.agent.get(`/api/families/${id}`)).body.family.inviteCode;
    await beto.agent.post('/api/families/join').send({ code }).expect(200);
    await caro.agent.post('/api/families/join').send({ code }).expect(200);

    await ana.agent.post(`/api/families/${id}/leave`).expect(204);
    expect(await membersOf(beto.agent, id)).toEqual(['beto:leader', 'caro:member']);

    // Expulsar
    await beto.agent.delete(`/api/families/${id}/members/${caro.user.id}`).expect(200);
    await caro.agent.get(`/api/families/${id}`).expect(404);
    await beto.agent.delete(`/api/families/${id}/members/${beto.user.id}`).expect(400, { error: 'USE_LEAVE' });

    await beto.agent.post(`/api/families/${id}/leave`).expect(204);
    expect((await db().query('SELECT count(*)::int AS n FROM families')).rows[0].n).toBe(0);
  });

  it('al eliminar la cuenta aplica la misma regla de sucesión', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const shared = await createFamily(ana.agent, 'Compartido');
    await createFamily(ana.agent, 'Solo de Ana');
    const code = (await ana.agent.get(`/api/families/${shared}`)).body.family.inviteCode;
    await beto.agent.post('/api/families/join').send({ code }).expect(200);

    await ana.agent.delete('/api/me').send({ password: PASSWORD }).expect(204);
    expect(await membersOf(beto.agent, shared)).toEqual(['beto:leader']);
    const names = (await db().query('SELECT name FROM families')).rows.map((r) => r.name);
    expect(names).toEqual(['Compartido']);
  });
});

describe('invitaciones', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('invita por apodo; el invitado la ve, la acepta y entra como miembro', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const id = await createFamily(ana.agent, 'Casa');

    await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'nadie' }).expect(404, { error: 'USER_NOT_FOUND' });
    await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'BETO' }).expect(201);
    await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'beto@test.com' }).expect(409, { error: 'INVITATION_PENDING' });

    const invitationMail = mail.sent.at(-1)!;
    expect(invitationMail.to).toBe('beto@test.com');
    expect(invitationMail.content.subject).toContain('ana');
    expect(invitationMail.content.text).toContain('http://app.test/familias');

    const mine = await beto.agent.get('/api/invitations').expect(200);
    expect(mine.body.invitations).toEqual([expect.objectContaining({ invitedBy: 'ana', family: expect.objectContaining({ name: 'Casa' }) })]);
    const invitationId = mine.body.invitations[0].id;

    // Otro usuario no puede responderla
    const caro = await createUser('caro', mail);
    await caro.agent.post(`/api/invitations/${invitationId}/accept`).expect(404);

    await beto.agent.post(`/api/invitations/${invitationId}/accept`).expect(200, { familyId: id });
    await beto.agent.post(`/api/invitations/${invitationId}/accept`).expect(400, { error: 'INVITATION_CLOSED' });
    expect(await membersOf(ana.agent, id)).toEqual(['ana:leader', 'beto:member']);
    expect((await beto.agent.get('/api/invitations')).body.invitations).toEqual([]);

    const list = await ana.agent.get(`/api/families/${id}/invitations`).expect(200);
    expect(list.body.invitations.map((i: { status: string }) => i.status)).toEqual(['accepted']);
    await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'beto' }).expect(409, { error: 'ALREADY_MEMBER' });
  });

  it('invita por correo a alguien sin cuenta: al registrarse con ese correo la encuentra', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const id = await createFamily(ana.agent);
    await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'Nuevo@Test.com' }).expect(201);
    expect(mail.sent.at(-1)!.to).toBe('nuevo@test.com');

    const nuevo = await createUser('nuevo', mail);
    const mine = await nuevo.agent.get('/api/invitations').expect(200);
    expect(mine.body.invitations).toHaveLength(1);
  });

  it('expira a los 7 días, se puede reenviar, cancelar o rechazar', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const id = await createFamily(ana.agent);
    const { body } = await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'beto' }).expect(201);

    const expiresAt = (await db().query('SELECT expires_at FROM family_invitations')).rows[0].expires_at as Date;
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(7);

    await db().query("UPDATE family_invitations SET expires_at = now() - interval '1 minute'");
    expect((await ana.agent.get(`/api/families/${id}/invitations`)).body.invitations[0].status).toBe('expired');
    expect((await beto.agent.get('/api/invitations')).body.invitations).toEqual([]);
    await beto.agent.post(`/api/invitations/${body.id}/accept`).expect(400, { error: 'INVITATION_EXPIRED' });

    const sentBefore = mail.sent.length;
    await ana.agent.post(`/api/families/${id}/invitations/${body.id}/resend`).expect(204);
    expect(mail.sent.length).toBe(sentBefore + 1);
    expect((await ana.agent.get(`/api/families/${id}/invitations`)).body.invitations[0].status).toBe('pending');

    await beto.agent.post(`/api/invitations/${body.id}/reject`).expect(204);
    expect((await ana.agent.get(`/api/families/${id}/invitations`)).body.invitations[0].status).toBe('rejected');
    await ana.agent.delete(`/api/families/${id}/invitations/${body.id}`).expect(400, { error: 'INVITATION_CLOSED' });

    const second = await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'beto' }).expect(201);
    await ana.agent.delete(`/api/families/${id}/invitations/${second.body.id}`).expect(204);
    expect((await ana.agent.get(`/api/families/${id}/invitations`)).body.invitations[0].status).toBe('cancelled');
  });

  it('entrar con el código cierra las invitaciones pendientes a ese grupo', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const beto = await createUser('beto', mail);
    const id = await createFamily(ana.agent);
    await ana.agent.post(`/api/families/${id}/invitations`).send({ target: 'beto' }).expect(201);
    const code = (await ana.agent.get(`/api/families/${id}`)).body.family.inviteCode;
    await beto.agent.post('/api/families/join').send({ code }).expect(200);
    expect((await ana.agent.get(`/api/families/${id}/invitations`)).body.invitations[0].status).toBe('accepted');
    await api().get('/api/invitations').expect(401);
  });
});

describe('miembro supervisado', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  async function familyWith(nicknames: string[]) {
    const mail = captureMail();
    const users = [];
    for (const n of nicknames) users.push(await createUser(n, mail));
    const id = await createFamily(users[0]!.agent);
    const code = (await users[0]!.agent.get(`/api/families/${id}`)).body.family.inviteCode;
    for (const u of users.slice(1)) await u.agent.post('/api/families/join').send({ code }).expect(200);
    return { id, users };
  }

  it('solo un líder asigna el rol supervisado; el último líder no puede pasar a supervisado', async () => {
    const { id, users } = await familyWith(['ana', 'beto', 'nico']);
    const [ana, beto, nico] = users;
    await beto!.agent.patch(`/api/families/${id}/members/${nico!.user.id}`).send({ role: 'supervised' }).expect(403);
    await ana!.agent.patch(`/api/families/${id}/members/${nico!.user.id}`).send({ role: 'supervised' }).expect(200);
    expect(await membersOf(ana!.agent, id)).toEqual(['ana:leader', 'beto:member', 'nico:supervised']);
    await ana!.agent.patch(`/api/families/${id}/members/${ana!.user.id}`).send({ role: 'supervised' }).expect(409, { error: 'LAST_LEADER' });
    await ana!.agent.patch(`/api/families/${id}/members/${nico!.user.id}`).send({ role: 'jefe' }).expect(400);
  });

  it('en la sucesión gana el miembro normal más antiguo aunque un supervisado haya entrado antes', async () => {
    const { id, users } = await familyWith(['ana', 'nico', 'beto']);
    const [ana, nico, beto] = users;
    await ana!.agent.patch(`/api/families/${id}/members/${nico!.user.id}`).send({ role: 'supervised' }).expect(200);
    await ana!.agent.post(`/api/families/${id}/leave`).expect(204);
    expect(await membersOf(beto!.agent, id)).toEqual(['beto:leader', 'nico:supervised']);
  });

  it('si solo quedan supervisados, el más antiguo pasa a líder', async () => {
    const { id, users } = await familyWith(['ana', 'nico', 'luz']);
    const [ana, nico, luz] = users;
    await ana!.agent.patch(`/api/families/${id}/members/${nico!.user.id}`).send({ role: 'supervised' }).expect(200);
    await ana!.agent.patch(`/api/families/${id}/members/${luz!.user.id}`).send({ role: 'supervised' }).expect(200);
    await ana!.agent.post(`/api/families/${id}/leave`).expect(204);
    expect(await membersOf(luz!.agent, id)).toEqual(['luz:supervised', 'nico:leader']);
  });
});
