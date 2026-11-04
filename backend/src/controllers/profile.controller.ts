import type { Request, Response } from 'express';
import { clearAuthCookies } from '../lib/auth-cookies.js';
import { currentUserId } from '../middlewares/auth.js';
import { profileService } from '../services/profile.service.js';

export const profileController = {
  async update(req: Request, res: Response): Promise<void> {
    res.json({ user: await profileService.update(currentUserId(req), req.body) });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    await profileService.changePassword(currentUserId(req), req.auth!.sessionId, req.body.currentPassword, req.body.newPassword);
    res.status(204).end();
  },

  async requestEmailChange(req: Request, res: Response): Promise<void> {
    await profileService.requestEmailChange(currentUserId(req), req.body.newEmail, req.body.password);
    res.status(202).json({ pendingEmail: req.body.newEmail });
  },

  async confirmEmailChange(req: Request, res: Response): Promise<void> {
    await profileService.confirmEmailChange(req.body.token);
    res.status(204).end();
  },

  async uploadAvatar(req: Request, res: Response): Promise<void> {
    res.json({ user: await profileService.uploadAvatar(currentUserId(req), req.body as Buffer) });
  },

  async setAvatarPreset(req: Request, res: Response): Promise<void> {
    res.json({ user: await profileService.setAvatarPreset(currentUserId(req), req.body.preset) });
  },

  async setSettings(req: Request, res: Response): Promise<void> {
    res.json({ user: await profileService.setSettings(currentUserId(req), req.body) });
  },

  async setTheme(req: Request, res: Response): Promise<void> {
    res.json({ user: await profileService.setTheme(currentUserId(req), req.body.theme) });
  },

  async deleteAccount(req: Request, res: Response): Promise<void> {
    await profileService.deleteAccount(currentUserId(req), req.body.password);
    clearAuthCookies(res);
    res.status(204).end();
  },
};
