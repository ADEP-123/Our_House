import type { Request, Response } from 'express';
import { currentUserId } from '../middlewares/auth.js';
import { scheduledService } from '../services/scheduled.service.js';

const id = (req: Request) => String(req.params.scheduleId);
const occurrence = (req: Request) => String(req.params.occurrenceId);
const familyId = (req: Request) => String(req.params.familyId);

export const scheduledController = {
  async list(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.list(familyId(req), currentUserId(req)));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await scheduledService.create(familyId(req), currentUserId(req), req.body));
  },

  async upcoming(req: Request, res: Response): Promise<void> {
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    if (!to) {
      res.status(400).json({ error: 'SCHEDULED_RANGE_INVALID' });
      return;
    }
    res.json(await scheduledService.upcoming(familyId(req), currentUserId(req), to));
  },

  async suggestions(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.suggestions(familyId(req), currentUserId(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.update(id(req), currentUserId(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await scheduledService.remove(id(req), currentUserId(req));
    res.status(204).end();
  },

  async pause(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.pause(id(req), currentUserId(req)));
  },

  async resume(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.resume(id(req), currentUserId(req)));
  },

  async skip(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.skip(id(req), currentUserId(req)));
  },

  async confirm(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.confirm(occurrence(req), currentUserId(req), req.body));
  },

  async dismiss(req: Request, res: Response): Promise<void> {
    res.json(await scheduledService.dismiss(occurrence(req), currentUserId(req)));
  },
};
