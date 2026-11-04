import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { healthRepository } from '../src/repositories/health.repository.js';

describe('GET /api/health', () => {
  afterEach(() => vi.restoreAllMocks());

  it('responde 200 cuando PostgreSQL contesta', async () => {
    vi.spyOn(healthRepository, 'ping').mockResolvedValue(true);
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('responde 503 cuando PostgreSQL no está disponible', async () => {
    vi.spyOn(healthRepository, 'ping').mockRejectedValue(new Error('sin conexión'));
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('responde 404 en rutas de API inexistentes', async () => {
    const res = await request(createApp()).get('/api/no-existe');
    expect(res.status).toBe(404);
  });
});
