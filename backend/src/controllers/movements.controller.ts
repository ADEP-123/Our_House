import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { movementsService, transfersService } from '../services/movements.service.js';

const accountId = (req: Request) => String(req.params.accountId);
const movementId = (req: Request) => String(req.params.movementId);

export const movementsController = {
  async listForAccount(req: Request, res: Response): Promise<void> {
    res.json(await movementsService.listForAccount(accountId(req), currentUserId(req), req.query.supervision === 'true'));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await movementsService.create(accountId(req), currentUserId(req), req.body));
  },

  async adjust(req: Request, res: Response): Promise<void> {
    res.status(201).json(await movementsService.adjust(accountId(req), currentUserId(req), req.body));
  },

  async setPrefs(req: Request, res: Response): Promise<void> {
    res.json(await movementsService.setHiddenColumns(accountId(req), currentUserId(req), req.body.hiddenColumns));
  },

  async suggestions(req: Request, res: Response): Promise<void> {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    res.json({ suggestions: await movementsService.suggestions(String(req.params.familyId), currentUserId(req), q) });
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json(await movementsService.update(movementId(req), currentUserId(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await movementsService.remove(movementId(req), currentUserId(req));
    res.status(204).end();
  },

  async restore(req: Request, res: Response): Promise<void> {
    res.json(await movementsService.restore(movementId(req), currentUserId(req)));
  },

  async history(req: Request, res: Response): Promise<void> {
    res.json({ history: await movementsService.history(movementId(req), currentUserId(req), req.query.supervision === 'true') });
  },
};

export const transfersController = {
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await transfersService.create(currentUserId(req), req.body));
  },
};
