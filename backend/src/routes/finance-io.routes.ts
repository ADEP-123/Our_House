import express, { Router } from 'express';
import { z } from 'zod';
import { financeIoController } from '../controllers/finance-io.controller.js';
import { LIST_COLORS, isListIcon } from '../lib/lists.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const MAX_MONEY = 100_000_000_000;
const row = z.int().min(1);
const text = (max: number, code: string) => z.string().trim().min(1, code).max(max, code);
const optionalText = (max: number, code: string) =>
  z
    .string()
    .trim()
    .max(max, code)
    .transform((v) => v || null)
    .nullable()
    .optional();

/** Filas ya leídas del archivo en el navegador (formato v1); el número de fila sirve para los mensajes.
 * La cantidad máxima de filas la revisa el servicio (IMPORT_TOO_MANY_ROWS). */
const importBody = z.strictObject({
  dryRun: z.boolean().default(true),
  accounts: z
    .array(
      z.strictObject({
        row,
        name: text(60, 'ACCOUNT_NAME_REQUIRED'),
        prefix: optionalText(4, 'ACCOUNT_PREFIX_INVALID'),
        kind: z.enum(['bank', 'cash', 'credit', 'savings'], 'ACCOUNT_KIND_INVALID'),
        description: optionalText(280, 'ACCOUNT_DESCRIPTION_TOO_LONG'),
        creditLimit: z.number('CREDIT_LIMIT_INVALID').min(0).max(MAX_MONEY).nullable().optional(),
      }),
    )
    .default([]),
  categories: z
    .array(
      z.strictObject({
        row,
        name: text(40, 'CATEGORY_NAME_REQUIRED'),
        icon: z
          .string()
          .trim()
          .refine((v) => !v || isListIcon(v), 'CATEGORY_ICON_INVALID')
          .nullable()
          .optional(),
        color: z.enum(LIST_COLORS, 'CATEGORY_COLOR_INVALID').nullable().optional(),
        active: z.boolean().nullable().optional(),
      }),
    )
    .default([]),
  movements: z
    .array(
      z.strictObject({
        row,
        code: optionalText(12, 'IMPORT_CODE_PREFIX'),
        account: text(60, 'IMPORT_ACCOUNT_REQUIRED'),
        date: z.iso.date('MOVEMENT_DATE_INVALID'),
        description: text(200, 'MOVEMENT_DESCRIPTION_REQUIRED'),
        category: optionalText(40, 'CATEGORY_NOT_FOUND'),
        kind: z.enum(['in', 'out', 'transfer', 'opening', 'adjust'], 'IMPORT_KIND_INVALID'),
        amount: z.number('MOVEMENT_AMOUNT_INVALID').min(-MAX_MONEY).max(MAX_MONEY),
        destination: optionalText(60, 'IMPORT_ACCOUNT_REQUIRED'),
      }),
    )
    .default([]),
});

/** /api/families/:familyId/import y /export */
export const familyFinanceIoRoutes = Router({ mergeParams: true });
// Middlewares por ruta: el router está montado en /families/:familyId y no debe tocar las demás rutas de grupos.
// Un archivo de miles de filas pesa más que el límite general.
familyFinanceIoRoutes.post('/import', requireAuth, checkIds, express.json({ limit: '4mb' }), validateBody(importBody), financeIoController.import);
familyFinanceIoRoutes.get('/export', requireAuth, checkIds, financeIoController.export);
