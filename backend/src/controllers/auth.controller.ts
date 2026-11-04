import type { Request, Response } from 'express';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../lib/auth-cookies.js';
import { currentUserId } from '../middlewares/auth.js';
import { authService } from '../services/auth.service.js';

const userAgent = (req: Request) => req.get('user-agent');

export const authController = {
  async nicknameAvailable(req: Request, res: Response): Promise<void> {
    const nickname = String(req.query.nickname ?? '').trim();
    res.json({ available: nickname.length > 0 && (await authService.isNicknameAvailable(nickname)) });
  },

  async register(req: Request, res: Response): Promise<void> {
    res.status(201).json(await authService.register(req.body));
  },

  async verifyEmail(req: Request, res: Response): Promise<void> {
    const result = await authService.verifyEmail(req.body.token, userAgent(req));
    setAuthCookies(res, result);
    res.json({ user: result.user });
  },

  async resendVerification(req: Request, res: Response): Promise<void> {
    await authService.resendVerification(req.body.email);
    res.status(204).end();
  },

  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body.identifier, req.body.password, userAgent(req));
    setAuthCookies(res, result);
    res.json({ user: result.user });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    try {
      setAuthCookies(res, await authService.refresh(req.cookies?.[REFRESH_COOKIE]));
      res.status(204).end();
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    res.status(204).end();
  },

  async logoutAll(req: Request, res: Response): Promise<void> {
    await authService.logoutAll(currentUserId(req));
    clearAuthCookies(res);
    res.status(204).end();
  },

  async forgotPassword(req: Request, res: Response): Promise<void> {
    await authService.forgotPassword(req.body.email);
    res.status(204).end();
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    await authService.resetPassword(req.body.token, req.body.password);
    clearAuthCookies(res);
    res.status(204).end();
  },

  async me(req: Request, res: Response): Promise<void> {
    res.json({ user: await authService.me(currentUserId(req)) });
  },
};
