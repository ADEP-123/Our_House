import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, resetDb } from './helpers.js';

const colors = {
  primary: '#3F5F90',
  onPrimary: '#ffffff',
  secondary: '#5e8c6a',
  background: '#f5f7fa',
  surface: '#ffffff',
  text: '#1b2230',
  success: '#2e7d4f',
  error: '#b3261e',
};

describe('paleta de colores', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('guarda la paleta, la devuelve con la sesión y se puede restablecer', async () => {
    const { agent } = await createUser('ana');
    expect((await agent.get('/api/auth/me')).body.user.theme).toBeNull();

    const res = await agent.put('/api/me/theme').send({ theme: { preset: 'custom', colors } }).expect(200);
    expect(res.body.user.theme).toEqual({ preset: 'custom', colors: { ...colors, primary: '#3f5f90' } });
    expect((await agent.get('/api/auth/me')).body.user.theme.colors.primary).toBe('#3f5f90');

    await agent.put('/api/me/theme').send({ theme: null }).expect(200);
    expect((await agent.get('/api/auth/me')).body.user.theme).toBeNull();
  });

  it('acepta los temas de temporada en versión clara y oscura', async () => {
    const { agent } = await createUser('ana');
    for (const preset of ['navidad', 'halloween-oscuro', 'otono', 'anionuevo-oscuro']) {
      expect((await agent.put('/api/me/theme').send({ theme: { preset, colors } }).expect(200)).body.user.theme.preset).toBe(preset);
    }
    await agent.put('/api/me/theme').send({ theme: { preset: 'claro-oscuro', colors } }).expect(400);
  });

  it('rechaza colores inválidos, colores de más y temas desconocidos', async () => {
    const { agent } = await createUser('ana');
    await agent.put('/api/me/theme').send({ theme: { preset: 'custom', colors: { ...colors, text: 'red' } } }).expect(400);
    await agent.put('/api/me/theme').send({ theme: { preset: 'custom', colors: { ...colors, extra: '#000000' } } }).expect(400);
    await agent.put('/api/me/theme').send({ theme: { preset: 'neon', colors } }).expect(400);
    const missing: Partial<typeof colors> = { ...colors };
    delete missing.error;
    await agent.put('/api/me/theme').send({ theme: { preset: 'custom', colors: missing } }).expect(400);
  });
});
