import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { db } from '../src/config/database.js';
import { api, captureMail, createUser, PASSWORD, resetDb } from './helpers.js';

const cookieNames = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split('=')[0]);

describe('registro y confirmación de correo', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('registra, envía el correo de confirmación y no deja entrar hasta confirmar', async () => {
    const mail = captureMail();
    await api()
      .post('/api/auth/register')
      .send({ email: 'Ana@Test.com', nickname: 'ana', password: PASSWORD, locale: 'en', timezone: 'America/Los_Angeles' })
      .expect(201, { email: 'ana@test.com' });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.content.subject).toContain('Confirm');
    expect(mail.sent[0]!.content.text).toContain('http://app.test/verificar-correo?token=');

    const login = await api().post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body).toEqual({ error: 'EMAIL_NOT_VERIFIED', email: 'ana@test.com' });

    const agent = request.agent(app);
    const verified = await agent.post('/api/auth/verify-email').send({ token: mail.lastToken('ana@test.com') });
    expect(verified.status).toBe(200);
    expect(cookieNames(verified)).toEqual(expect.arrayContaining(['oh_at', 'oh_rt']));
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ nickname: 'ana', locale: 'en', timezone: 'America/Los_Angeles' });
  });

  it('valida la contraseña y el apodo con códigos por campo', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'no-es-correo', nickname: 'a', password: 'solo-letras' })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION');
    expect(res.body.fields).toEqual({
      email: 'EMAIL_INVALID',
      nickname: 'NICKNAME_TOO_SHORT',
      password: 'PASSWORD_NEEDS_NUMBER',
    });
  });

  it('el apodo y el correo son únicos sin importar mayúsculas', async () => {
    const mail = captureMail();
    await createUser('Ana', mail);
    await api().post('/api/auth/register').send({ email: 'otra@test.com', nickname: 'ANA', password: PASSWORD }).expect(409, { error: 'NICKNAME_TAKEN' });
    await api().post('/api/auth/register').send({ email: 'ANA@test.com', nickname: 'ana2', password: PASSWORD }).expect(409, { error: 'EMAIL_TAKEN' });
    await api().get('/api/auth/nickname-available?nickname=aNa').expect(200, { available: false });
    await api().get('/api/auth/nickname-available?nickname=beto').expect(200, { available: true });
  });

  it('un enlace de confirmación vencido o reemplazado no sirve', async () => {
    const mail = captureMail();
    await api().post('/api/auth/register').send({ email: 'ana@test.com', nickname: 'ana', password: PASSWORD }).expect(201);
    const first = mail.lastToken('ana@test.com');

    // El reenvío respeta 1 minuto entre correos
    await api().post('/api/auth/resend-verification').send({ email: 'ana@test.com' }).expect(204);
    expect(mail.sent).toHaveLength(1);
    await db().query("UPDATE email_tokens SET created_at = now() - interval '2 minutes'");
    await api().post('/api/auth/resend-verification').send({ email: 'ana@test.com' }).expect(204);
    expect(mail.sent).toHaveLength(2);

    await api().post('/api/auth/verify-email').send({ token: first }).expect(400, { error: 'TOKEN_INVALID' });
    await db().query("UPDATE email_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL");
    await api()
      .post('/api/auth/verify-email')
      .send({ token: mail.lastToken('ana@test.com') })
      .expect(400, { error: 'TOKEN_EXPIRED' });
  });
});

describe('inicio de sesión y sesiones', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('entra con correo o con apodo', async () => {
    await createUser('Beto');
    await api().post('/api/auth/login').send({ identifier: 'BETO@test.com', password: PASSWORD }).expect(200);
    const res = await api().post('/api/auth/login').send({ identifier: 'beto', password: PASSWORD }).expect(200);
    expect(res.body.user.nickname).toBe('Beto');
  });

  it('bloquea 15 minutos tras 5 intentos fallidos', async () => {
    await createUser('ana');
    for (let left = 4; left >= 1; left--) {
      await api().post('/api/auth/login').send({ identifier: 'ana', password: 'mala-clave-1' }).expect(401, { error: 'INVALID_CREDENTIALS', attemptsLeft: left });
    }
    const locked = await api().post('/api/auth/login').send({ identifier: 'ana', password: 'mala-clave-1' }).expect(423);
    expect(locked.body.error).toBe('ACCOUNT_LOCKED');
    // Ni con la contraseña correcta mientras dura el bloqueo
    await api().post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD }).expect(423);

    await db().query("UPDATE users SET locked_until = now() - interval '1 second'");
    await api().post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD }).expect(200);
  });

  it('rota el refresh token y corta la sesión si reutilizan uno viejo', async () => {
    const { agent } = await createUser('ana');
    const oldRefresh = (await db().query('SELECT id FROM sessions')).rows[0].id as string;

    const first = await agent.post('/api/auth/refresh').expect(204);
    expect(cookieNames(first)).toEqual(expect.arrayContaining(['oh_at', 'oh_rt']));
    await agent.get('/api/auth/me').expect(200);

    // Un secreto robado/viejo: la sesión se elimina
    await api().post('/api/auth/refresh').set('Cookie', `oh_rt=${oldRefresh}.secreto-viejo`).expect(401);
    expect((await db().query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0);
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('cerrar sesión en todos los dispositivos invalida los refresh tokens', async () => {
    const { agent } = await createUser('ana');
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD }).expect(200);

    await agent.post('/api/auth/logout-all').expect(204);
    await other.post('/api/auth/refresh').expect(401);
    await api().get('/api/auth/me').expect(401);
  });
});

describe('recuperar contraseña', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('restablece con el enlace, cierra las sesiones y el enlace no se reutiliza', async () => {
    const mail = captureMail();
    const { agent } = await createUser('ana', mail);

    await api().post('/api/auth/forgot-password').send({ email: 'nadie@test.com' }).expect(204);
    await api().post('/api/auth/forgot-password').send({ email: 'ana@test.com' }).expect(204);
    const token = mail.lastToken('ana@test.com');
    expect(mail.sent.at(-1)!.content.text).toContain('/restablecer-contrasena?token=');

    await api().post('/api/auth/reset-password').send({ token, password: 'corta1' }).expect(400);
    await api().post('/api/auth/reset-password').send({ token, password: 'nueva-clave-456' }).expect(204);
    await api().post('/api/auth/reset-password').send({ token, password: 'otra-clave-789' }).expect(400, { error: 'TOKEN_INVALID' });

    await agent.post('/api/auth/refresh').expect(401);
    await api().post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD }).expect(401);
    await api().post('/api/auth/login').send({ identifier: 'ana', password: 'nueva-clave-456' }).expect(200);
  });
});
