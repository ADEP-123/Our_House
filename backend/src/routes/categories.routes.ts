import { Router } from 'express';
import { z } from 'zod';
import { categoriesController } from '../controllers/categories.controller.js';
import { LIST_COLORS, isListIcon } from '../lib/lists.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const fields = {
  name: z.string().trim().min(1, 'CATEGORY_NAME_REQUIRED').max(40, 'CATEGORY_NAME_TOO_LONG'),
  /** Mismos íconos y colores que las listas */
  icon: z.string().trim().refine(isListIcon, 'ICON_INVALID'),
  color: z.enum(LIST_COLORS, 'CATEGORY_COLOR_INVALID'),
};

/** /api/families/:familyId/categories */
export const familyCategoriesRoutes = Router({ mergeParams: true });
familyCategoriesRoutes.use(requireAuth, checkIds);
familyCategoriesRoutes.get('/', categoriesController.listForFamily);
familyCategoriesRoutes.post(
  '/',
  validateBody(z.object({ id: z.uuid().optional(), ...fields, icon: fields.icon.default('📦'), color: fields.color.default('gray') })),
  categoriesController.create,
);

/** /api/categories/:categoryId (solo líderes) */
export const categoriesRoutes = Router();
categoriesRoutes.use(requireAuth);
const category = Router({ mergeParams: true });
categoriesRoutes.use('/:categoryId', checkIds, category);

category.patch('/', validateBody(z.object({ ...fields, disabled: z.boolean() }).partial()), categoriesController.update);
category.get('/movements', categoriesController.movements);
category.post(
  '/delete',
  validateBody(
    z.strictObject({
      moveTo: z.uuid().nullable().optional(),
      overrides: z
        .array(z.strictObject({ movementId: z.uuid(), categoryId: z.uuid() }))
        .max(5000)
        .default([]),
    }),
  ),
  categoriesController.remove,
);
