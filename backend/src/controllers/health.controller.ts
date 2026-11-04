import type { Request, Response } from 'express';
import { healthService } from '../services/health.service.js';

export const healthController = {
  async get(_req: Request, res: Response): Promise<void> {
    const health = await healthService.check();
    res.status(health.db === 'up' ? 200 : 503).json(health);
  },
};
