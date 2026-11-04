import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { usersRepository } from '../repositories/users.repository.js';
import { familiesService } from '../services/families.service.js';
import { invitationsService } from '../services/invitations.service.js';

const familyId = (req: Request) => String(req.params.familyId);

export const familiesController = {
  async list(req: Request, res: Response): Promise<void> {
    res.json({ families: await familiesService.listMine(currentUserId(req)) });
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ family: await familiesService.create(currentUserId(req), req.body.name) });
  },

  async detail(req: Request, res: Response): Promise<void> {
    res.json({ family: await familiesService.detail(familyId(req), currentUserId(req)) });
  },

  async rename(req: Request, res: Response): Promise<void> {
    res.json({ family: await familiesService.rename(familyId(req), currentUserId(req), req.body.name) });
  },

  async uploadAvatar(req: Request, res: Response): Promise<void> {
    res.json({ family: await familiesService.uploadAvatar(familyId(req), currentUserId(req), req.body as Buffer) });
  },

  async setAvatarPreset(req: Request, res: Response): Promise<void> {
    res.json({ family: await familiesService.setAvatarPreset(familyId(req), currentUserId(req), req.body.preset) });
  },

  async regenerateCode(req: Request, res: Response): Promise<void> {
    res.json(await familiesService.regenerateInviteCode(familyId(req), currentUserId(req)));
  },

  async join(req: Request, res: Response): Promise<void> {
    const user = (await usersRepository.findById(currentUserId(req)))!;
    res.json({ family: await familiesService.joinWithCode(user.id, user.email, req.body.code) });
  },

  async setRole(req: Request, res: Response): Promise<void> {
    res.json({
      family: await familiesService.setRole(familyId(req), currentUserId(req), String(req.params.userId), req.body.role),
    });
  },

  async expel(req: Request, res: Response): Promise<void> {
    res.json({ family: await familiesService.expel(familyId(req), currentUserId(req), String(req.params.userId)) });
  },

  async leave(req: Request, res: Response): Promise<void> {
    await familiesService.leave(familyId(req), currentUserId(req));
    res.status(204).end();
  },

  // ---------- Invitaciones del grupo (líderes) ----------

  async invite(req: Request, res: Response): Promise<void> {
    res.status(201).json(await invitationsService.invite(familyId(req), currentUserId(req), req.body.target));
  },

  async listInvitations(req: Request, res: Response): Promise<void> {
    res.json({ invitations: await invitationsService.listForFamily(familyId(req), currentUserId(req)) });
  },

  async resendInvitation(req: Request, res: Response): Promise<void> {
    await invitationsService.resend(familyId(req), String(req.params.invitationId), currentUserId(req));
    res.status(204).end();
  },

  async cancelInvitation(req: Request, res: Response): Promise<void> {
    await invitationsService.cancel(familyId(req), String(req.params.invitationId), currentUserId(req));
    res.status(204).end();
  },

  // ---------- Invitaciones recibidas ----------

  async myInvitations(req: Request, res: Response): Promise<void> {
    res.json({ invitations: await invitationsService.listMine(currentUserId(req)) });
  },

  async accept(req: Request, res: Response): Promise<void> {
    res.json(await invitationsService.respond(String(req.params.invitationId), currentUserId(req), true));
  },

  async reject(req: Request, res: Response): Promise<void> {
    await invitationsService.respond(String(req.params.invitationId), currentUserId(req), false);
    res.status(204).end();
  },
};
