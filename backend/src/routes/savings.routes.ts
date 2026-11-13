import { Router } from 'express';
import { z } from 'zod';
import { savingsController } from '../controllers/savings.controller.js';
import { isListIcon } from '../lib/lists.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const MAX_MONEY = 100_000_000_000;
const money = (code: string) => z.number(code).positive(code).max(MAX_MONEY, code);

const project = z.strictObject({
  name: z.string().trim().min(1, 'SAVINGS_NAME_REQUIRED').max(60, 'SAVINGS_NAME_TOO_LONG'),
  icon: z.string().trim().refine(isListIcon, 'SAVINGS_ICON_INVALID').default('🎯'),
  goal: money('SAVINGS_GOAL_INVALID').nullable().optional(),
  targetDate: z.iso.date('SAVINGS_DATE_INVALID').nullable().optional(),
});

/** /api/families/:familyId/savings */
export const familySavingsRoutes = Router({ mergeParams: true });
familySavingsRoutes.use(requireAuth, checkIds);
familySavingsRoutes.get('/', savingsController.list);
familySavingsRoutes.post('/', validateBody(project.extend({ id: z.uuid().optional() })), savingsController.create);

/** /api/families/:familyId/budgets */
export const familyBudgetsRoutes = Router({ mergeParams: true });
familyBudgetsRoutes.use(requireAuth, checkIds);
familyBudgetsRoutes.get('/', savingsController.budgets);

/** /api/savings/:projectId */
export const savingsRoutes = Router();
savingsRoutes.use(requireAuth);
const one = Router({ mergeParams: true });
savingsRoutes.use('/:projectId', checkIds, one);
one.put('/', validateBody(project), savingsController.update);
one.post('/close', savingsController.close);
one.post('/reopen', savingsController.reopen);
one.delete('/', savingsController.remove);
one.get('/history', savingsController.history);
one.post(
  '/move',
  validateBody(
    z.strictObject({
      accountId: z.uuid('SAVINGS_ACCOUNT_INVALID'),
      action: z.enum(['set_aside', 'release']),
      amount: money('SAVINGS_AMOUNT_INVALID'),
    }),
  ),
  savingsController.move,
);

/** PUT /api/categories/:categoryId/budget { amount | null } */
export const categoryBudgetRoute = Router({ mergeParams: true });
categoryBudgetRoute.put(
  '/',
  requireAuth,
  checkIds,
  validateBody(z.strictObject({ amount: money('BUDGET_AMOUNT_INVALID').nullable() })),
  savingsController.setBudget,
);
