import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../middlewares/auth.js';
import { financeIoService } from '../services/finance-io.service.js';

const exportQuery = z.object({
  from: z.iso.date('SUMMARY_RANGE_INVALID').optional(),
  to: z.iso.date('SUMMARY_RANGE_INVALID').optional(),
  accounts: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(100).optional()),
});

export const financeIoController = {
  async import(req: Request, res: Response): Promise<void> {
    const { dryRun, ...input } = req.body;
    res.json(await financeIoService.import(String(req.params.familyId), currentUserId(req), input, dryRun));
  },

  async export(req: Request, res: Response): Promise<void> {
    res.json(await financeIoService.export(String(req.params.familyId), currentUserId(req), exportQuery.parse(req.query)));
  },
};
