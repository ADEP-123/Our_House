import { Router } from 'express';
import { z } from 'zod';
import { accountsController } from '../controllers/accounts.controller.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';
import { mountAccountMovements } from './movements.routes.js';

const ROLES = ['leader', 'member', 'supervised'] as const;
const MAX_MONEY = 100_000_000_000;

/** Datos completos de la cuenta: se envían igual al crear y al guardar cambios */
const accountBody = z.object({
  name: z.string().trim().min(1, 'ACCOUNT_NAME_REQUIRED').max(60, 'ACCOUNT_NAME_TOO_LONG'),
  description: z
    .string()
    .trim()
    .max(280, 'ACCOUNT_DESCRIPTION_TOO_LONG')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  kind: z.enum(['bank', 'cash', 'credit', 'savings'], 'ACCOUNT_KIND_INVALID'),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,4}$/, 'ACCOUNT_PREFIX_INVALID'),
  creditLimit: z.number('CREDIT_LIMIT_INVALID').min(0, 'CREDIT_LIMIT_INVALID').max(MAX_MONEY, 'CREDIT_LIMIT_INVALID').nullable().optional(),
  opening: z
    .strictObject({
      amount: z.number('OPENING_INVALID').min(-MAX_MONEY, 'OPENING_INVALID').max(MAX_MONEY, 'OPENING_INVALID'),
      date: z.iso.date('OPENING_DATE_INVALID'),
    })
    .nullable()
    .optional(),
  viewMode: z.enum(['family', 'members', 'private']).default('family'),
  editMode: z.enum(['roles', 'members']).default('roles'),
  editRoles: z
    .array(z.enum(ROLES))
    .max(3)
    .default(['leader', 'member'])
    .transform((r) => [...new Set(r)]),
  viewers: z.array(z.uuid()).max(50).default([]),
  editors: z.array(z.uuid()).max(50).default([]),
});

/** /api/families/:familyId/accounts */
export const familyAccountsRoutes = Router({ mergeParams: true });
familyAccountsRoutes.use(requireAuth, checkIds);
familyAccountsRoutes.get('/', accountsController.listForFamily);
familyAccountsRoutes.post('/', validateBody(accountBody.extend({ id: z.uuid().optional() })), accountsController.create);

/** /api/accounts/:accountId */
export const accountsRoutes = Router();
accountsRoutes.use(requireAuth);
const account = Router({ mergeParams: true });
accountsRoutes.use('/:accountId', checkIds, account);

account.get('/', accountsController.detail);
account.put('/', validateBody(accountBody), accountsController.update);
account.post('/archive', accountsController.archive);
account.post('/restore', accountsController.restore);
account.delete('/', accountsController.remove);

// Movimientos, ajuste de saldo y columnas ocultas de la cuenta
mountAccountMovements(account);
