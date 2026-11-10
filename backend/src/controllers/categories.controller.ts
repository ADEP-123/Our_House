import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { categoriesService } from '../services/categories.service.js';

const categoryId = (req: Request) => String(req.params.categoryId);

export const categoriesController = {
  async listForFamily(req: Request, res: Response): Promise<void> {
    res.json(await categoriesService.listForFamily(String(req.params.familyId), currentUserId(req)));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ category: await categoriesService.create(String(req.params.familyId), currentUserId(req), req.body) });
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json({ category: await categoriesService.update(categoryId(req), currentUserId(req), req.body) });
  },

  async movements(req: Request, res: Response): Promise<void> {
    res.json(await categoriesService.movements(categoryId(req), currentUserId(req)));
  },

  /** POST en vez de DELETE con cuerpo: lleva a dónde pasar los movimientos */
  async remove(req: Request, res: Response): Promise<void> {
    await categoriesService.remove(categoryId(req), currentUserId(req), req.body);
    res.status(204).end();
  },
};
