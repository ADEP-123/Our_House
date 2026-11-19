import { Router } from 'express';
import { z } from 'zod';
import { debtsController } from '../controllers/debts.controller.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const MAX_MONEY = 100_000_000_000;
const money = (code: string) => z.number(code).positive(code).max(MAX_MONEY, code);
const optionalText = (max: number, code: string) =>
  z
    .string()
    .trim()
    .max(max, code)
    .transform((v) => v || null)
    .nullable()
    .optional();

const debt = z.strictObject({
  direction: z.enum(['owe', 'owed'], 'DEBT_DIRECTION_INVALID'),
  title: z.string().trim().min(1, 'DEBT_TITLE_REQUIRED').max(80, 'DEBT_TITLE_TOO_LONG'),
  description: optionalText(280, 'DEBT_DESCRIPTION_TOO_LONG'),
  counterparty: z.string().trim().min(1, 'DEBT_PERSON_REQUIRED').max(60, 'DEBT_PERSON_TOO_LONG'),
  amount: money('DEBT_AMOUNT_INVALID'),
  dueDate: z.iso.date('DEBT_DATE_INVALID').nullable().optional(),
  installments: z.int('DEBT_INSTALLMENTS_INVALID').min(2, 'DEBT_INSTALLMENTS_INVALID').max(600, 'DEBT_INSTALLMENTS_INVALID').nullable().optional(),
  interestRate: z.number('DEBT_INTEREST_INVALID').positive('DEBT_INTEREST_INVALID').max(100, 'DEBT_INTEREST_INVALID').nullable().optional(),
  interestPeriod: z.enum(['monthly', 'annual']).nullable().optional(),
  viewMode: z.enum(['family', 'members', 'private']).default('family'),
  viewers: z.array(z.uuid()).max(50).default([]),
});

const entry = z.strictObject({
  id: z.uuid().optional(),
  kind: z.enum(['payment', 'increase', 'decrease'], 'DEBT_ENTRY_KIND_INVALID'),
  amount: money('DEBT_ENTRY_AMOUNT_INVALID'),
  date: z.iso.date('DEBT_ENTRY_DATE_INVALID'),
  note: optionalText(200, 'DEBT_NOTE_TOO_LONG'),
  accountId: z.uuid('ACCOUNT_NOT_FOUND').nullable().optional(),
  categoryId: z.uuid('CATEGORY_NOT_FOUND').nullable().optional(),
});

/** /api/families/:familyId/debts */
export const familyDebtsRoutes = Router({ mergeParams: true });
familyDebtsRoutes.use(requireAuth, checkIds);
familyDebtsRoutes.get('/', debtsController.list);
familyDebtsRoutes.post('/', validateBody(debt.extend({ id: z.uuid().optional() })), debtsController.create);

/** /api/debts/:debtId y /api/debts/entries/:entryId */
export const debtsRoutes = Router();
debtsRoutes.use(requireAuth);
debtsRoutes.delete('/entries/:entryId', checkIds, debtsController.removeEntry);
const one = Router({ mergeParams: true });
debtsRoutes.use('/:debtId', checkIds, one);
one.put('/', validateBody(debt), debtsController.update);
one.delete('/', debtsController.remove);
one.get('/history', debtsController.history);
one.post('/entries', validateBody(entry), debtsController.addEntry);
