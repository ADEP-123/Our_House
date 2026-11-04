import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';
import { ACCESS_TTL_SECONDS } from './jwt.js';

export const ACCESS_COOKIE = 'oh_at';
export const REFRESH_COOKIE = 'oh_rt';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// httpOnly: JavaScript no puede leerlas. strict: el navegador no las manda desde otros sitios (evita CSRF).
const base: CookieOptions = { httpOnly: true, secure: env.isProduction, sameSite: 'strict' };
// El refresh token solo viaja a /api/auth, no en cada petición
const refreshOptions: CookieOptions = { ...base, path: '/api/auth' };

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, path: '/', maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...refreshOptions, maxAge: REFRESH_TTL_MS });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, refreshOptions);
}
