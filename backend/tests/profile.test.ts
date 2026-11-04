import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { db } from '../src/config/database.js';
import { storageService } from '../src/services/storage.service.js';
import { api, captureMail, createUser, PASSWORD, resetDb } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe('perfil', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('actualiza nombre, apellido, apodo, idioma y zona horaria', async () => {
    const { agent } = await createUser('ana');
    const res = await agent
      .patch('/api/me')
      .send({ firstName: ' Ana ', lastName: 'Gómez', nickname: 'anita', locale: 'en', timezone: 'Europe/Madrid' })
      .expect(200);
    expect(res.body.user).toMatchObject({
      firstName: 'Ana',
      lastName: 'Gómez',
      nickname: 'anita',
      locale: 'en',
      timezone: 'Europe/Madrid',
    });

    // Campo vacío borra el dato; los demás quedan igual
    const cleared = await agent.patch('/api/me').send({ lastName: '' }).expect(200);
    expect(cleared.body.user).toMatchObject({ firstName: 'Ana', lastName: null, nickname: 'anita' });

    await agent.patch('/api/me').send({ timezone: 'Marte/Base' }).expect(400);
  });

  it('no permite tomar el apodo de otra persona', async () => {
    const mail = captureMail();
    await createUser('beto', mail);
    const { agent } = await createUser('ana', mail);
    await agent.patch('/api/me').send({ nickname: 'BETO' }).expect(409, { error: 'NICKNAME_TAKEN' });
    await agent.patch('/api/me').send({ nickname: 'ANA' }).expect(200); // el suyo, con otras mayúsculas
  });

  it('cambia la contraseña con la actual y cierra solo las otras sesiones', async () => {
    const { agent } = await createUser('ana');
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD }).expect(200);

    await agent.put('/api/me/password').send({ currentPassword: 'equivocada1', newPassword: 'nueva-clave-456' }).expect(403, { error: 'WRONG_PASSWORD' });
    await agent.put('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'corta' }).expect(400);
    await agent.put('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'nueva-clave-456' }).expect(204);

    await agent.post('/api/auth/refresh').expect(204);
    await other.post('/api/auth/refresh').expect(401);
    await api().post('/api/auth/login').send({ identifier: 'ana', password: 'nueva-clave-456' }).expect(200);
  });

  it('cambia el correo solo después de confirmar el nuevo y avisa al anterior', async () => {
    const mail = captureMail();
    const { agent } = await createUser('ana', mail);
    await createUser('beto', mail);

    await agent.post('/api/me/email').send({ newEmail: 'beto@test.com', password: PASSWORD }).expect(409, { error: 'EMAIL_TAKEN' });
    await agent.post('/api/me/email').send({ newEmail: 'nueva@test.com', password: 'equivocada1' }).expect(403);
    await agent.post('/api/me/email').send({ newEmail: 'Nueva@Test.com', password: PASSWORD }).expect(202);

    // Todavía usa el correo anterior
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('ana@test.com');

    const token = mail.lastToken('nueva@test.com');
    await api().post('/api/auth/confirm-email-change').send({ token }).expect(204);
    await api().post('/api/auth/confirm-email-change').send({ token }).expect(400, { error: 'TOKEN_INVALID' });

    expect((await agent.get('/api/auth/me')).body.user.email).toBe('nueva@test.com');
    const notice = mail.sent.at(-1)!;
    expect(notice.to).toBe('ana@test.com');
    expect(notice.content.text).toContain('nueva@test.com');
    await api().post('/api/auth/login').send({ identifier: 'nueva@test.com', password: PASSWORD }).expect(200);
  });

  it('sube un avatar validando tipo y tamaño, y lo reemplaza por un predefinido', async () => {
    const upload = vi.spyOn(storageService, 'upload').mockResolvedValue('https://blob.test/avatars/users/a.png');
    const remove = vi.spyOn(storageService, 'remove').mockResolvedValue();
    const { agent } = await createUser('ana');

    const res = await agent.put('/api/me/avatar').set('Content-Type', 'image/png').send(PNG).expect(200);
    expect(res.body.user).toMatchObject({ avatarUrl: 'https://blob.test/avatars/users/a.png', avatarPreset: null });
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^avatars\/users\/.+\.png$/), expect.any(Buffer), 'image/png');

    // Un archivo que dice ser PNG pero no lo es
    await agent.put('/api/me/avatar').set('Content-Type', 'image/png').send(Buffer.from('<svg></svg>')).expect(400, { error: 'FILE_TYPE_NOT_ALLOWED' });
    await agent.put('/api/me/avatar').set('Content-Type', 'image/png').send(Buffer.alloc(2 * 1024 * 1024 + 1)).expect(413, { error: 'FILE_TOO_LARGE' });

    const preset = await agent.put('/api/me/avatar-preset').send({ preset: 'fox' }).expect(200);
    expect(preset.body.user).toMatchObject({ avatarUrl: null, avatarPreset: 'fox' });
    expect(remove).toHaveBeenCalledWith('https://blob.test/avatars/users/a.png');

    await agent.put('/api/me/avatar-preset').send({ preset: 'dragon' }).expect(400);
    const initials = await agent.put('/api/me/avatar-preset').send({ preset: null }).expect(200);
    expect(initials.body.user.avatarPreset).toBeNull();
  });

  it('elimina la cuenta solo con la contraseña correcta', async () => {
    const { agent } = await createUser('ana');
    await agent.delete('/api/me').send({ password: 'equivocada1' }).expect(403);
    await agent.delete('/api/me').send({ password: PASSWORD }).expect(204);
    expect((await db().query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(0);
    await api().post('/api/auth/login').send({ identifier: 'ana', password: PASSWORD }).expect(401);
  });
});
