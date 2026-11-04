import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE } from '../lib/auth-cookies.js';
import { unauthorized } from '../lib/http-error.js';
import { verifyAccessToken, type AccessClaims } from '../lib/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessClaims;
    }
  }
}

/** Exige un JWT de acceso válido. Si venció, el frontend llama a /api/auth/refresh y reintenta. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const claims = await verifyAccessToken(req.cookies?.[ACCESS_COOKIE] ?? '');
  if (!claims) throw unauthorized();
  req.auth = claims;
  next();
}

/** Id del usuario autenticado (usar solo en rutas protegidas con requireAuth). */
export const currentUserId = (req: Request): string => req.auth!.userId;
