import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/config/database.js';
import { verificationCodesService } from '../src/services/verification-codes.service.js';
import { captureMail, createUser, resetDb } from './helpers.js';

describe('códigos de verificación por correo', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const lastCode = (mail: ReturnType<typeof captureMail>) => mail.sent.at(-1)!.content.subject.slice(0, 6);

  it('envía 6 dígitos al correo y los acepta una sola vez', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    const res = await ana.agent.post('/api/me/verification-codes').send({ purpose: 'secrets' }).expect(202);
    expect(res.body.resendIn).toBe(60);
    expect(mail.sent.at(-1)!.to).toBe('ana@test.com');
    const code = lastCode(mail);
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await db().query('SELECT code_hash FROM verification_codes');
    expect(rows[0].code_hash).not.toContain(code);

    await verificationCodesService.verify(ana.user.id, 'secrets', code);
    await expect(verificationCodesService.verify(ana.user.id, 'secrets', code)).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
  });

  it('cuenta los intentos fallidos y bloquea al quinto', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    await ana.agent.post('/api/me/verification-codes').send({ purpose: 'secrets' }).expect(202);
    const code = lastCode(mail);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left--) {
      await expect(verificationCodesService.verify(ana.user.id, 'secrets', wrong)).rejects.toMatchObject({ code: 'CODE_INVALID', details: { attemptsLeft: left } });
    }
    await expect(verificationCodesService.verify(ana.user.id, 'secrets', wrong)).rejects.toMatchObject({ code: 'CODE_TOO_MANY_ATTEMPTS' });
    await expect(verificationCodesService.verify(ana.user.id, 'secrets', code)).rejects.toMatchObject({ code: 'CODE_TOO_MANY_ATTEMPTS' });
  });

  it('vence a los 10 minutos; pedir otro espera 60 segundos y anula el anterior', async () => {
    const mail = captureMail();
    const ana = await createUser('ana', mail);
    await ana.agent.post('/api/me/verification-codes').send({ purpose: 'secrets' }).expect(202);
    const first = lastCode(mail);
    const again = await ana.agent.post('/api/me/verification-codes').send({ purpose: 'secrets' }).expect(429);
    expect(again.body).toMatchObject({ error: 'CODE_COOLDOWN' });
    expect(again.body.retryIn).toBeGreaterThan(55);

    await db().query("UPDATE verification_codes SET created_at = now() - interval '2 minutes'");
    await ana.agent.post('/api/me/verification-codes').send({ purpose: 'secrets' }).expect(202);
    const second = lastCode(mail);
    if (first !== second) await expect(verificationCodesService.verify(ana.user.id, 'secrets', first)).rejects.toMatchObject({ code: 'CODE_INVALID' });

    await db().query("UPDATE verification_codes SET expires_at = now() - interval '1 second'");
    await expect(verificationCodesService.verify(ana.user.id, 'secrets', second)).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
    await ana.agent.post('/api/me/verification-codes').send({ purpose: 'otra' }).expect(400);
  });
});
