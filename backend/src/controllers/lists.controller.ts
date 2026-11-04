import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { listsService } from '../services/lists.service.js';

const listId = (req: Request) => String(req.params.listId);

export const listsController = {
  async listForFamily(req: Request, res: Response): Promise<void> {
    const archived = req.query.archived === 'true';
    res.json(await listsService.listForFamily(String(req.params.familyId), currentUserId(req), archived));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ list: await listsService.create(String(req.params.familyId), currentUserId(req), req.body) });
  },

  async detail(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.detail(listId(req), currentUserId(req), req.query.supervision === 'true') });
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.update(listId(req), currentUserId(req), req.body) });
  },

  async archive(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.setArchived(listId(req), currentUserId(req), true) });
  },

  async restore(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.setArchived(listId(req), currentUserId(req), false) });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await listsService.remove(listId(req), currentUserId(req));
    res.status(204).end();
  },

  async pin(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.setPinned(listId(req), currentUserId(req), req.body.pinned) });
  },

  async duplicate(req: Request, res: Response): Promise<void> {
    res.status(201).json({ list: await listsService.duplicate(listId(req), currentUserId(req), req.body) });
  },
};
