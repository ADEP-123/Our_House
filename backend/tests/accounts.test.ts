import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, setupFamily, type User } from './helpers.js';

async function createAccount(user: User, familyId: string, body: Record<string, unknown> = {}) {
  const res = await user.agent
    .post(`/api/families/${familyId}/accounts`)
    .send({ name: 'Nu', kind: 'bank', prefix: 'T', ...body })
    .expect(201);
  return res.body.account as Record<string, any>;
}

const names = async (user: User, familyId: string, archived = false) =>
  ((await user.agent.get(`/api/families/${familyId}/accounts${archived ? '?archived=true' : ''}`).expect(200)).body.accounts as {
    name: string;
  }[]).map((a) => a.name);

/** Cuerpo completo para PUT a partir de la vista */
const bodyOf = (a: Record<string, any>, changes: Record<string, unknown> = {}) => ({
  name: a.name,
  description: a.description,
  kind: a.kind,
  prefix: a.prefix,
  creditLimit: a.credit?.limit ?? null,
  opening: a.opening && { amount: a.opening.amount, date: a.opening.date },
  viewMode: a.viewMode,
  editMode: a.editMode,
  editRoles: a.editRoles,
  viewers: a.viewers,
  editors: a.editors,
  ...changes,
});

describe('cuentas: crear y saldo', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('crea la cuenta con descripción, prefijo en mayúsculas y saldo inicial como primer movimiento', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const account = await createAccount(users.ana!, familyId, {
      name: 'Efectivo',
      kind: 'cash',
      prefix: 'e',
      description: 'Dinero en la billetera',
      opening: { amount: 6135, date: '2026-03-17' },
    });
    expect(account).toMatchObject({
      name: 'Efectivo',
      prefix: 'E',
      description: 'Dinero en la billetera',
      currency: 'USD',
      balance: 6135,
      opening: { amount: 6135, date: '2026-03-17', number: 1 },
      credit: null,
      viewMode: 'family',
      editMode: 'roles',
      editRoles: ['leader', 'member'],
      owner: { nickname: 'ana' },
      permissions: { canEdit: true, canAdmin: true, supervision: false },
    });
  });

  it('el prefijo no se repite en el grupo y valida formato', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    await createAccount(users.ana!, familyId, { prefix: 'NU' });
    await users.ana!.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Otra', kind: 'bank', prefix: 'nu' }).expect(409, { error: 'ACCOUNT_PREFIX_TAKEN' });
    const bad = await users.ana!.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Otra', kind: 'bank', prefix: 'N-1' }).expect(400);
    expect(bad.body.fields).toEqual({ prefix: 'ACCOUNT_PREFIX_INVALID' });
  });

  it('tarjeta de crédito: exige cupo y muestra deuda y disponible; superar el cupo solo se marca', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    await users.ana!.agent.post(`/api/families/${familyId}/accounts`).send({ name: 'Visa', kind: 'credit', prefix: 'V' }).expect(400, { error: 'CREDIT_LIMIT_REQUIRED' });
    const card = await createAccount(users.ana!, familyId, {
      name: 'Visa',
      kind: 'credit',
      prefix: 'V',
      creditLimit: 1000,
      opening: { amount: -250.5, date: '2026-11-01' },
    });
    expect(card).toMatchObject({ balance: -250.5, credit: { limit: 1000, debt: 250.5, available: 749.5, overLimit: false } });

    const over = await users.ana!.agent.put(`/api/accounts/${card.id}`).send(bodyOf(card, { creditLimit: 200 })).expect(200);
    expect(over.body.account.credit).toEqual({ limit: 200, debt: 250.5, available: -50.5, overLimit: true });

    // Si deja de ser tarjeta, el cupo se borra
    const bank = await users.ana!.agent.put(`/api/accounts/${card.id}`).send(bodyOf(card, { kind: 'bank' })).expect(200);
    expect(bank.body.account.credit).toBeNull();
  });

  it('cambiar o quitar el saldo inicial', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const account = await createAccount(users.ana!, familyId);
    expect(account).toMatchObject({ balance: 0, opening: null });

    const withOpening = await users.ana!.agent.put(`/api/accounts/${account.id}`).send(bodyOf(account, { opening: { amount: 100, date: '2026-01-01' } })).expect(200);
    expect(withOpening.body.account).toMatchObject({ balance: 100, opening: { amount: 100, date: '2026-01-01' } });
    const changed = await users.ana!.agent.put(`/api/accounts/${account.id}`).send(bodyOf(account, { opening: { amount: 80, date: '2026-01-02' } })).expect(200);
    expect(changed.body.account.balance).toBe(80);
    const removed = await users.ana!.agent.put(`/api/accounts/${account.id}`).send(bodyOf(account, { opening: { amount: 0, date: '2026-01-02' } })).expect(200);
    expect(removed.body.account).toMatchObject({ balance: 0, opening: null });
  });

  it('reenviar la misma creación (mismo id) no duplica', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const id = randomUUID();
    await createAccount(users.ana!, familyId, { id, opening: { amount: 10, date: '2026-01-01' } });
    const again = await createAccount(users.ana!, familyId, { id, opening: { amount: 10, date: '2026-01-01' } });
    expect(again.balance).toBe(10);
    expect(await names(users.ana!, familyId)).toEqual(['Nu']);
  });
});

describe('cuentas: quién ve y quién edita', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('del grupo la ven todos; privada solo quien la creó (ni los líderes)', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await createAccount(users.beto!, familyId, { name: 'Casa', prefix: 'C' });
    const priv = await createAccount(users.beto!, familyId, { name: 'Mía', prefix: 'M', viewMode: 'private' });

    expect(await names(users.ana!, familyId)).toEqual(['Casa']);
    expect(await names(users.beto!, familyId)).toEqual(['Casa', 'Mía']);
    await users.ana!.agent.get(`/api/accounts/${priv.id}`).expect(404);
  });

  it('personas elegidas: solo ellas la ven; quien edita también la ve', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'caro', 'dani']);
    const account = await createAccount(users.ana!, familyId, {
      viewMode: 'members',
      editMode: 'members',
      viewers: [users.beto!.user.id],
      editors: [users.caro!.user.id],
    });
    expect(account.viewers.sort()).toEqual([users.beto!.user.id, users.caro!.user.id].sort());
    expect(account.editors).toEqual([users.caro!.user.id]);

    const asBeto = await users.beto!.agent.get(`/api/accounts/${account.id}`).expect(200);
    expect(asBeto.body.account.permissions).toMatchObject({ canEdit: false, canAdmin: false });
    const asCaro = await users.caro!.agent.get(`/api/accounts/${account.id}`).expect(200);
    expect(asCaro.body.account.permissions).toMatchObject({ canEdit: true, canAdmin: false });
    await users.dani!.agent.get(`/api/accounts/${account.id}`).expect(404);
    expect(await names(users.dani!, familyId)).toEqual([]);
  });

  it('editar por rol: solo los roles elegidos; administrar solo quien la creó', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'nico'], ['nico']);
    const account = await createAccount(users.beto!, familyId, { editRoles: ['leader'] });

    const perms = async (u: User) => (await u.agent.get(`/api/accounts/${account.id}`).expect(200)).body.account.permissions;
    expect(await perms(users.ana!)).toMatchObject({ canEdit: true, canAdmin: false });
    expect(await perms(users.beto!)).toMatchObject({ canEdit: true, canAdmin: true }); // quien la creó siempre
    expect(await perms(users.nico!)).toMatchObject({ canEdit: false });

    await users.ana!.agent.put(`/api/accounts/${account.id}`).send(bodyOf(account, { name: 'x' })).expect(403, { error: 'ACCOUNT_ADMIN_ONLY' });
    await users.ana!.agent.post(`/api/accounts/${account.id}/archive`).expect(403);
    await users.ana!.agent.delete(`/api/accounts/${account.id}`).expect(403);

    const all = await users.beto!.agent.put(`/api/accounts/${account.id}`).send(bodyOf(account, { editRoles: ['leader', 'member', 'supervised'] })).expect(200);
    expect(all.body.account.editRoles).toEqual(['leader', 'member', 'supervised']);
    expect(await perms(users.nico!)).toMatchObject({ canEdit: true });
  });

  it('solo se pueden elegir personas del grupo', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    await users.ana!.agent
      .post(`/api/families/${familyId}/accounts`)
      .send({ name: 'Nu', kind: 'bank', prefix: 'T', viewMode: 'members', viewers: [randomUUID()] })
      .expect(400, { error: 'ACCOUNT_MEMBER_INVALID' });
  });

  it('un líder ve la privada de un supervisado solo tras confirmar, en modo lectura', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'nico'], ['nico']);
    const priv = await createAccount(users.nico!, familyId, { name: 'Alcancía', prefix: 'A', viewMode: 'private' });

    const leaderList = (await users.ana!.agent.get(`/api/families/${familyId}/accounts`).expect(200)).body;
    expect(leaderList.accounts).toEqual([]);
    expect(leaderList.supervisedPrivate).toEqual([{ id: priv.id, ownerNickname: 'nico' }]);
    expect((await users.beto!.agent.get(`/api/families/${familyId}/accounts`)).body.supervisedPrivate).toEqual([]);

    await users.ana!.agent.get(`/api/accounts/${priv.id}`).expect(403, { error: 'SUPERVISION_CONFIRMATION_REQUIRED' });
    const seen = await users.ana!.agent.get(`/api/accounts/${priv.id}?supervision=true`).expect(200);
    expect(seen.body.account).toMatchObject({ name: 'Alcancía', permissions: { canEdit: false, canAdmin: false, supervision: true } });
    await users.beto!.agent.get(`/api/accounts/${priv.id}?supervision=true`).expect(404);
  });
});

describe('cuentas: archivar, borrar y salir del grupo', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('archivada: aparece aparte, no se edita y se puede restaurar o borrar', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const account = await createAccount(users.ana!, familyId);
    const archived = await users.ana!.agent.post(`/api/accounts/${account.id}/archive`).expect(200);
    expect(archived.body.account.permissions.canEdit).toBe(false);
    expect(await names(users.ana!, familyId)).toEqual([]);
    expect(await names(users.ana!, familyId, true)).toEqual(['Nu']);
    await users.ana!.agent.put(`/api/accounts/${account.id}`).send(bodyOf(account, { name: 'x' })).expect(403, { error: 'ACCOUNT_ARCHIVED' });

    await users.ana!.agent.post(`/api/accounts/${account.id}/restore`).expect(200);
    expect(await names(users.ana!, familyId)).toEqual(['Nu']);
    await users.ana!.agent.delete(`/api/accounts/${account.id}`).expect(204);
    await users.ana!.agent.get(`/api/accounts/${account.id}`).expect(404);
  });

  it('si quien la creó sale del grupo: sus privadas se borran y las demás las administran los líderes', async () => {
    const { familyId, users } = await setupFamily(['ana', 'beto', 'caro']);
    const shared = await createAccount(users.beto!, familyId, { name: 'Casa', prefix: 'C' });
    await createAccount(users.beto!, familyId, { name: 'Mía', prefix: 'M', viewMode: 'private' });
    const chosen = await createAccount(users.ana!, familyId, { name: 'Viaje', prefix: 'V', viewMode: 'members', viewers: [users.beto!.user.id] });

    await users.beto!.agent.post(`/api/families/${familyId}/leave`).expect(204);

    const asLeader = await users.ana!.agent.get(`/api/accounts/${shared.id}`).expect(200);
    expect(asLeader.body.account).toMatchObject({ owner: null, permissions: { canAdmin: true } });
    const asMember = await users.caro!.agent.get(`/api/accounts/${shared.id}`).expect(200);
    expect(asMember.body.account.permissions.canAdmin).toBe(false);
    expect(await names(users.ana!, familyId)).toEqual(['Casa', 'Viaje']);
    expect((await users.ana!.agent.get(`/api/accounts/${chosen.id}`)).body.account.viewers).toEqual([]);
  });

  it('quien no es del grupo no ve nada', async () => {
    const { familyId, users } = await setupFamily(['ana']);
    const other = await setupFamily(['zoe']);
    const account = await createAccount(users.ana!, familyId);
    await other.users.zoe!.agent.get(`/api/families/${familyId}/accounts`).expect(404);
    await other.users.zoe!.agent.get(`/api/accounts/${account.id}`).expect(404);
  });
});
