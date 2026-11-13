import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { accountsService } from '../services/accounts.service.js';

const accountId = (req: Request) => String(req.params.accountId);

export const accountsController = {
  async listForFamily(req: Request, res: Response): Promise<void> {
    const archived = req.query.archived === 'true';
    res.json(await accountsService.listForFamily(String(req.params.familyId), currentUserId(req), archived));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ account: await accountsService.create(String(req.params.familyId), currentUserId(req), req.body) });
  },

  async detail(req: Request, res: Response): Promise<void> {
    res.json({ account: await accountsService.detail(accountId(req), currentUserId(req), req.query.supervision === 'true') });
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json({ account: await accountsService.update(accountId(req), currentUserId(req), req.body) });
  },

  async archive(req: Request, res: Response): Promise<void> {
    res.json({ account: await accountsService.setArchived(accountId(req), currentUserId(req), true) });
  },

  async restore(req: Request, res: Response): Promise<void> {
    res.json({ account: await accountsService.setArchived(accountId(req), currentUserId(req), false) });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await accountsService.remove(accountId(req), currentUserId(req));
    res.status(204).end();
  },
};
