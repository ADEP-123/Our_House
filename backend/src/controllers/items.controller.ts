import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { itemsService } from '../services/items.service.js';

const ids = (req: Request) => ({ listId: String(req.params.listId), itemId: String(req.params.itemId) });

export const itemsController = {
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ item: await itemsService.create(ids(req).listId, currentUserId(req), req.body) });
  },

  async update(req: Request, res: Response): Promise<void> {
    const { listId, itemId } = ids(req);
    res.json({ item: await itemsService.update(listId, itemId, currentUserId(req), req.body) });
  },

  async setCompleted(req: Request, res: Response): Promise<void> {
    const { listId, itemId } = ids(req);
    res.json({ item: await itemsService.setCompleted(listId, itemId, currentUserId(req), req.body.completed) });
  },

  async purchase(req: Request, res: Response): Promise<void> {
    const { listId, itemId } = ids(req);
    res.json({ item: await itemsService.purchase(listId, itemId, currentUserId(req), req.body) });
  },

  async assignedToMe(req: Request, res: Response): Promise<void> {
    res.json({ tasks: await itemsService.assignedTo(currentUserId(req)) });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const { listId, itemId } = ids(req);
    await itemsService.remove(listId, itemId, currentUserId(req));
    res.status(204).end();
  },

  async uncheckAll(req: Request, res: Response): Promise<void> {
    res.json({ list: await itemsService.uncheckAll(ids(req).listId, currentUserId(req)) });
  },

  async deleteCompleted(req: Request, res: Response): Promise<void> {
    res.json({ list: await itemsService.deleteCompleted(ids(req).listId, currentUserId(req)) });
  },
};
