import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { debtsService } from '../services/debts.service.js';

const debtId = (req: Request) => String(req.params.debtId);

export const debtsController = {
  async list(req: Request, res: Response): Promise<void> {
    res.json(await debtsService.list(String(req.params.familyId), currentUserId(req)));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await debtsService.create(String(req.params.familyId), currentUserId(req), req.body));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json(await debtsService.update(debtId(req), currentUserId(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await debtsService.remove(debtId(req), currentUserId(req));
    res.status(204).end();
  },

  async history(req: Request, res: Response): Promise<void> {
    res.json({ history: await debtsService.history(debtId(req), currentUserId(req)) });
  },

  async addEntry(req: Request, res: Response): Promise<void> {
    res.status(201).json(await debtsService.addEntry(debtId(req), currentUserId(req), req.body));
  },

  async removeEntry(req: Request, res: Response): Promise<void> {
    await debtsService.removeEntry(String(req.params.entryId), currentUserId(req));
    res.status(204).end();
  },
};
