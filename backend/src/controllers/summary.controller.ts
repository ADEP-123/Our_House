import type { Request, Response } from 'express';
import { z } from 'zod';
import { SUMMARY_FREQS } from '../lib/summary.js';
import { currentUserId } from '../middlewares/auth.js';
import { summaryService } from '../services/summary.service.js';

const query = z.object({
  from: z.iso.date('SUMMARY_RANGE_INVALID'),
  to: z.iso.date('SUMMARY_RANGE_INVALID'),
  freq: z.enum(SUMMARY_FREQS, 'SUMMARY_FREQ_INVALID').default('month'),
  accounts: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(100).optional()),
});

export const summaryController = {
  async get(req: Request, res: Response): Promise<void> {
    res.json(await summaryService.get(String(req.params.familyId), currentUserId(req), query.parse(req.query)));
  },

  async prefs(req: Request, res: Response): Promise<void> {
    res.json(await summaryService.prefs(String(req.params.familyId), currentUserId(req)));
  },

  async setPrefs(req: Request, res: Response): Promise<void> {
    res.json(await summaryService.setPrefs(String(req.params.familyId), currentUserId(req), req.body.config));
  },
};
