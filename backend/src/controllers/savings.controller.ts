import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { savingsService } from '../services/savings.service.js';

const projectId = (req: Request) => String(req.params.projectId);

export const savingsController = {
  async list(req: Request, res: Response): Promise<void> {
    res.json(await savingsService.list(String(req.params.familyId), currentUserId(req)));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await savingsService.create(String(req.params.familyId), currentUserId(req), req.body));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json(await savingsService.update(projectId(req), currentUserId(req), req.body));
  },

  async close(req: Request, res: Response): Promise<void> {
    res.json(await savingsService.close(projectId(req), currentUserId(req)));
  },

  async reopen(req: Request, res: Response): Promise<void> {
    res.json(await savingsService.reopen(projectId(req), currentUserId(req)));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await savingsService.remove(projectId(req), currentUserId(req));
    res.status(204).end();
  },

  async move(req: Request, res: Response): Promise<void> {
    res.json(await savingsService.move(projectId(req), currentUserId(req), req.body));
  },

  async history(req: Request, res: Response): Promise<void> {
    res.json({ history: await savingsService.history(projectId(req), currentUserId(req)) });
  },

  async budgets(req: Request, res: Response): Promise<void> {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    res.json(await savingsService.budgets(String(req.params.familyId), currentUserId(req), month));
  },

  async setBudget(req: Request, res: Response): Promise<void> {
    res.json(await savingsService.setBudget(String(req.params.categoryId), currentUserId(req), req.body.amount));
  },
};
