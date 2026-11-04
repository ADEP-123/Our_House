import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { currentUserId } from '../middlewares/auth.js';
import { calendarService } from '../services/calendar.service.js';

const STATE_COOKIE = 'oh_gstate';
// lax: la cookie tiene que viajar en la vuelta desde accounts.google.com (navegación entre sitios)
const stateCookie: CookieOptions = { httpOnly: true, secure: env.isProduction, sameSite: 'lax', path: '/api/google', maxAge: 10 * 60_000 };

const back = (result: 'connected' | 'cancelled' | 'error') => `${env.appUrl}/perfil?google=${result}#calendario`;

export const googleController = {
  async status(req: Request, res: Response): Promise<void> {
    res.json(await calendarService.status(currentUserId(req)));
  },

  async connect(req: Request, res: Response): Promise<void> {
    const { url, nonce } = await calendarService.start(currentUserId(req));
    res.cookie(STATE_COOKIE, nonce, stateCookie);
    res.json({ url });
  },

  /** Google redirige aquí. Siempre termina en el perfil, con el resultado en la URL. */
  async callback(req: Request, res: Response): Promise<void> {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const nonce = req.cookies?.[STATE_COOKIE] as string | undefined;
    res.clearCookie(STATE_COOKIE, { ...stateCookie, maxAge: undefined });
    if (error || !code || !state) return res.redirect(back(error === 'access_denied' ? 'cancelled' : 'error'));
    try {
      await calendarService.finish(code, state, nonce);
      res.redirect(back('connected'));
    } catch (err) {
      console.error('[calendario] conexión', err);
      res.redirect(back('error'));
    }
  },

  async disconnect(req: Request, res: Response): Promise<void> {
    await calendarService.disconnect(currentUserId(req));
    res.status(204).end();
  },
};
