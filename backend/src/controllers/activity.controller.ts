import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../middlewares/auth.js';
import { activityService } from '../services/activity.service.js';

const filtersSchema = z.object({
  listId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const activityController = {
  async list(req: Request, res: Response): Promise<void> {
    const filters = filtersSchema.parse(req.query);
    res.json(await activityService.list(String(req.params.familyId), currentUserId(req), filters));
  },

  async filters(req: Request, res: Response): Promise<void> {
    res.json(await activityService.filters(String(req.params.familyId), currentUserId(req)));
  },
};
