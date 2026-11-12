import { Router } from 'express';
import { z } from 'zod';
import { movementsController, transfersController } from '../controllers/movements.controller.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';
import { MOVEMENT_COLUMNS } from '../services/movements.service.js';

const MAX_MONEY = 100_000_000_000;
const amount = z.number('MOVEMENT_AMOUNT_INVALID').positive('MOVEMENT_AMOUNT_INVALID').max(MAX_MONEY, 'MOVEMENT_AMOUNT_INVALID');
const description = z.string().trim().min(1, 'MOVEMENT_DESCRIPTION_REQUIRED').max(200, 'MOVEMENT_DESCRIPTION_TOO_LONG');
const date = z.iso.date('MOVEMENT_DATE_INVALID');

/** Se montan dentro de /api/accounts/:accountId */
export function mountAccountMovements(account: Router): void {
  account.get('/movements', movementsController.listForAccount);
  account.post(
    '/movements',
    validateBody(
      z.strictObject({
        id: z.uuid().optional(),
        kind: z.enum(['in', 'out'], 'MOVEMENT_KIND_INVALID'),
        amount,
        date,
        description,
        categoryId: z.uuid('CATEGORY_REQUIRED'),
        savingsProjectId: z.uuid('SAVINGS_NOT_FOUND').nullable().optional(),
      }),
    ),
    movementsController.create,
  );
  account.post(
    '/adjust',
    validateBody(
      z.strictObject({
        id: z.uuid().optional(),
        balance: z.number('BALANCE_INVALID').min(-MAX_MONEY, 'BALANCE_INVALID').max(MAX_MONEY, 'BALANCE_INVALID'),
        date,
        description,
      }),
    ),
    movementsController.adjust,
  );
  account.put(
    '/prefs',
    validateBody(z.strictObject({ hiddenColumns: z.array(z.enum(MOVEMENT_COLUMNS)).max(MOVEMENT_COLUMNS.length).transform((c) => [...new Set(c)]) })),
    movementsController.setPrefs,
  );
}

/** /api/families/:familyId/movement-suggestions?q= */
export const familyMovementsRoutes = Router({ mergeParams: true });
familyMovementsRoutes.use(requireAuth, checkIds);
familyMovementsRoutes.get('/', movementsController.suggestions);

/** /api/movements/:movementId */
export const movementsRoutes = Router();
movementsRoutes.use(requireAuth);
const movement = Router({ mergeParams: true });
movementsRoutes.use('/:movementId', checkIds, movement);

movement.patch(
  '/',
  validateBody(
    z
      .strictObject({
        kind: z.enum(['in', 'out'], 'MOVEMENT_KIND_INVALID'),
        // Los ajustes llevan signo: aquí se acepta cualquier número distinto de cero y el servicio valida según el tipo
        amount: z.number('MOVEMENT_AMOUNT_INVALID').min(-MAX_MONEY, 'MOVEMENT_AMOUNT_INVALID').max(MAX_MONEY, 'MOVEMENT_AMOUNT_INVALID'),
        date,
        description,
        categoryId: z.uuid('CATEGORY_REQUIRED'),
        savingsProjectId: z.uuid('SAVINGS_NOT_FOUND').nullable().optional(),
      })
      .partial(),
  ),
  movementsController.update,
);
movement.delete('/', movementsController.remove);
movement.post('/restore', movementsController.restore);
movement.get('/history', movementsController.history);

/** /api/transfers — entre dos cuentas del grupo (también el pago de una tarjeta) */
export const transfersRoutes = Router();
transfersRoutes.use(requireAuth);
transfersRoutes.post(
  '/',
  validateBody(
    z.strictObject({
      id: z.uuid().optional(),
      outId: z.uuid().optional(),
      inId: z.uuid().optional(),
      fromAccountId: z.uuid('TRANSFER_ACCOUNT_REQUIRED'),
      toAccountId: z.uuid('TRANSFER_ACCOUNT_REQUIRED'),
      amount,
      date,
      description,
    }),
  ),
  transfersController.create,
);
