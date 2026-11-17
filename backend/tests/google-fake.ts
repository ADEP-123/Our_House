import request from 'supertest';
import { expect, vi } from 'vitest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { settleBackground } from '../src/lib/background.js';
import type { User } from './helpers.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Google simulado: responde a OAuth y Calendar y anota cada llamada */
export function fakeGoogle() {
  const calls: Call[] = [];
  let nextEvent = 1;
  const events = new Map<string, Record<string, unknown>>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const raw = typeof init.body === 'string' ? init.body : '';
      const body = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method, url, body });
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.endsWith('/token')) {
        if (body.grant_type === 'authorization_code') return json({ access_token: 'at-1', refresh_token: 'rt-secreto', expires_in: 3600 });
        return json({ access_token: 'at-2', expires_in: 3600 });
      }
      if (url.includes('/userinfo')) return json({ email: 'ana@gmail.com' });
      if (url.endsWith('/calendars') && method === 'POST') return json({ id: 'cal-our-house' });
      if (url.endsWith('/revoke')) return new Response('', { status: 200 });
      const m = url.match(/\/events(?:\/([^/?]+))?$/);
      if (m) {
        if (method === 'POST') {
          const id = `ev-${nextEvent++}`;
          events.set(id, body);
          return json({ id });
        }
        if (method === 'PUT') {
          if (!events.has(m[1]!)) return new Response('{"error":"gone"}', { status: 410 });
          events.set(m[1]!, body);
          return json({ id: m[1] });
        }
        if (method === 'DELETE') {
          events.delete(m[1]!);
          return new Response(null, { status: 204 });
        }
      }
      return new Response('no simulado', { status: 500 });
    }),
  );
  return { calls, events };
}

/** Conecta la cuenta de Google de una persona recorriendo el flujo completo */
export async function connect(user: User) {
  const start = await user.agent.post('/api/google/connect').expect(200);
  const url = new URL(start.body.url);
  expect(url.hostname).toBe('accounts.google.com');
  expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.app.created');
  expect(url.searchParams.get('access_type')).toBe('offline');
  const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('oh_gstate='))!;
  expect(cookie).toContain('SameSite=Lax');
  // Google vuelve con un navegador sin la cookie de sesión (Strict), solo con la del state
  const back = await request(app)
    .get(`/api/google/callback?code=codigo&state=${url.searchParams.get('state')}`)
    .set('Cookie', cookie.split(';')[0]!)
    .expect(302);
  expect(back.headers.location).toBe(`${env.appUrl}/perfil?google=connected#calendario`);
  await settleBackground();
}
