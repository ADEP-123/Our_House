import { Router } from 'express';
import { z } from 'zod';
import { scheduledController } from '../controllers/scheduled.controller.js';
import { REPEAT_FREQS } from '../lib/recurrence.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const MAX_MONEY = 100_000_000_000;
const amount = z.number('MOVEMENT_AMOUNT_INVALID').positive('MOVEMENT_AMOUNT_INVALID').max(MAX_MONEY, 'MOVEMENT_AMOUNT_INVALID');

/** Un programado: qué se registra, cada cuánto y desde cuándo (regla de repetición de la Fase 5) */
const body = z.strictObject({
  accountId: z.uuid('SCHEDULED_ACCOUNT_INVALID'),
  kind: z.enum(['in', 'out', 'transfer', 'set_aside'], 'SCHEDULED_KIND_INVALID'),
  toAccountId: z.uuid('TRANSFER_ACCOUNT_REQUIRED').nullable().optional(),
  savingsProjectId: z.uuid('SAVINGS_NOT_FOUND').nullable().optional(),
  categoryId: z.uuid('CATEGORY_REQUIRED').nullable().optional(),
  amount,
  description: z.string().trim().min(1, 'MOVEMENT_DESCRIPTION_REQUIRED').max(200, 'MOVEMENT_DESCRIPTION_TOO_LONG'),
  mode: z.enum(['auto', 'confirm']).default('auto'),
  rule: z.strictObject({
    freq: z.enum(REPEAT_FREQS, 'REPEAT_INVALID'),
    interval: z.int('REPEAT_INVALID').min(1, 'REPEAT_INVALID').max(365, 'REPEAT_INVALID').default(1),
    weekdays: z
      .array(z.int().min(0).max(6))
      .max(7)
      .optional()
      .transform((d) => (d?.length ? [...new Set(d)].sort() : undefined)),
    start: z.iso.date('SCHEDULED_START_INVALID'),
    until: z.iso.date('REPEAT_INVALID').nullable().optional(),
    count: z.int('REPEAT_INVALID').min(1, 'REPEAT_INVALID').max(999, 'REPEAT_INVALID').nullable().optional(),
  }),
  remindDays: z.int('SCHEDULED_REMIND_INVALID').min(1, 'SCHEDULED_REMIND_INVALID').max(30, 'SCHEDULED_REMIND_INVALID').nullable().optional(),
  notifyDone: z.boolean().default(true),
});

/** /api/families/:familyId/scheduled */
export const familyScheduledRoutes = Router({ mergeParams: true });
familyScheduledRoutes.use(requireAuth, checkIds);
familyScheduledRoutes.get('/', scheduledController.list);
familyScheduledRoutes.post('/', validateBody(body.extend({ id: z.uuid().optional() })), scheduledController.create);
familyScheduledRoutes.get('/upcoming', scheduledController.upcoming);
familyScheduledRoutes.get('/suggestions', scheduledController.suggestions);

/** /api/scheduled/:scheduleId y /api/scheduled/occurrences/:occurrenceId */
export const scheduledRoutes = Router();
scheduledRoutes.use(requireAuth);
scheduledRoutes.post(
  '/occurrences/:occurrenceId/confirm',
  checkIds,
  validateBody(z.strictObject({ amount, date: z.iso.date('MOVEMENT_DATE_INVALID').optional() })),
  scheduledController.confirm,
);
scheduledRoutes.post('/occurrences/:occurrenceId/dismiss', checkIds, scheduledController.dismiss);
const one = Router({ mergeParams: true });
scheduledRoutes.use('/:scheduleId', checkIds, one);
one.put('/', validateBody(body), scheduledController.update);
one.delete('/', scheduledController.remove);
one.post('/pause', scheduledController.pause);
one.post('/resume', scheduledController.resume);
one.post('/skip', scheduledController.skip);
