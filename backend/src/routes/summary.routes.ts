import { Router } from 'express';
import { z } from 'zod';
import { summaryController } from '../controllers/summary.controller.js';
import { SUMMARY_FREQS } from '../lib/summary.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

/** Configuración del resumen que se recuerda por persona */
const config = z.strictObject({
  mode: z.enum(['month', 'year', 'range']),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  year: z.int().min(1900).max(2200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  freq: z.enum(SUMMARY_FREQS),
  accounts: z.array(z.uuid()).max(100).default([]),
  view: z.enum(['combined', 'separate', 'both']),
});

/** /api/families/:familyId/summary */
export const familySummaryRoutes = Router({ mergeParams: true });
familySummaryRoutes.use(requireAuth, checkIds);
familySummaryRoutes.get('/', summaryController.get);
familySummaryRoutes.get('/prefs', summaryController.prefs);
familySummaryRoutes.put('/prefs', validateBody(z.strictObject({ config })), summaryController.setPrefs);
