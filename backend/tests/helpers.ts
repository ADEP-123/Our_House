import request from 'supertest';
import { vi } from 'vitest';
import app from '../src/app.js';
import { db } from '../src/config/database.js';
import { mailer } from '../src/lib/mailer.js';
import type { EmailContent } from '../src/lib/email-templates.js';

export const api = () => request(app);

export const resetDb = () => db().query('TRUNCATE users CASCADE');

/** Captura los correos en vez de enviarlos. */
export function captureMail() {
  const sent: { to: string; content: EmailContent }[] = [];
  vi.spyOn(mailer, 'send').mockImplementation(async (to, content) => {
    sent.push({ to, content });
  });
  return {
    sent,
    /** Extrae el token del último enlace enviado a ese correo. */
    lastToken(to: string): string {
      const mail = sent.filter((m) => m.to === to).at(-1);
      const token = mail?.content.text.match(/token=([\w-]+)/)?.[1];
      if (!token) throw new Error(`No hay enlace con token para ${to}`);
      return token;
    },
  };
}

export const PASSWORD = 'clave-segura-123';

/** Registra y confirma un usuario; devuelve un agente con la sesión iniciada. */
export async function createUser(nickname: string, mail = captureMail()) {
  const email = `${nickname.toLowerCase()}@test.com`;
  await api().post('/api/auth/register').send({ email, nickname, password: PASSWORD }).expect(201);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/verify-email').send({ token: mail.lastToken(email) }).expect(200);
  return { agent, email, user: res.body.user as { id: string; nickname: string; email: string } };
}
