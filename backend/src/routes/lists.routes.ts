import { Router } from 'express';
import { z } from 'zod';
import { activityController } from '../controllers/activity.controller.js';
import { itemsController } from '../controllers/items.controller.js';
import { listsController } from '../controllers/lists.controller.js';
import { LIST_COLORS, LIST_ICONS, LIST_TYPES } from '../lib/lists.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const listName = z.string().trim().min(1, 'LIST_NAME_REQUIRED').max(80, 'LIST_NAME_TOO_LONG');
/** Id generado por el cliente (opcional): permite crear sin conexión sin duplicar al reenviar */
const clientId = z.uuid().optional();

/** /api/families/:familyId/lists */
export const familyListsRoutes = Router({ mergeParams: true });
familyListsRoutes.use(requireAuth, checkIds);
familyListsRoutes.get('/', listsController.listForFamily);
familyListsRoutes.post(
  '/',
  validateBody(
    z.object({
      id: clientId,
      name: listName,
      type: z.enum(LIST_TYPES),
      color: z.enum(LIST_COLORS).default('blue'),
      icon: z.enum(LIST_ICONS).default('check'),
      isPrivate: z.boolean().default(false),
    }),
  ),
  listsController.create,
);

/** /api/families/:familyId/activity — bitácora, solo líderes */
export const familyActivityRoutes = Router({ mergeParams: true });
familyActivityRoutes.use(requireAuth, checkIds);
familyActivityRoutes.get('/', activityController.list);
familyActivityRoutes.get('/filters', activityController.filters);

/** /api/lists/:listId */
export const listsRoutes = Router();
listsRoutes.use(requireAuth);
const list = Router({ mergeParams: true });
listsRoutes.use('/:listId', checkIds, list);

list.get('/', listsController.detail);
list.patch(
  '/',
  validateBody(
    z
      .object({ name: listName, color: z.enum(LIST_COLORS), icon: z.enum(LIST_ICONS), isPrivate: z.boolean() })
      .partial(),
  ),
  listsController.update,
);
list.post('/archive', listsController.archive);
list.post('/restore', listsController.restore);
list.delete('/', listsController.remove);
list.put('/pin', validateBody(z.object({ pinned: z.boolean() })), listsController.pin);
list.post('/duplicate', validateBody(z.object({ id: clientId, name: listName })), listsController.duplicate);

// ---------- Ítems ----------

/** Texto opcional: vacío se guarda como null */
const optionalText = (max: number, code: string) =>
  z
    .string()
    .trim()
    .max(max, code)
    .transform((v) => v || null)
    .nullable()
    .optional();

const itemFields = {
  note: optionalText(500, 'ITEM_NOTE_TOO_LONG'),
  amount: z.number('AMOUNT_INVALID').positive('AMOUNT_INVALID').max(1_000_000, 'AMOUNT_INVALID').nullable().optional(),
  unit: optionalText(20, 'ITEM_UNIT_TOO_LONG'),
  category: optionalText(40, 'ITEM_CATEGORY_TOO_LONG'),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.iso.date('DUE_DATE_INVALID').nullable().optional(),
  position: z.number().finite().optional(),
};
const itemText = z.string().trim().min(1, 'ITEM_TEXT_REQUIRED').max(200, 'ITEM_TEXT_TOO_LONG');

list.post('/items', validateBody(z.object({ id: clientId, text: itemText, ...itemFields })), itemsController.create);
list.post('/reset', itemsController.uncheckAll);
list.post('/clear-completed', itemsController.deleteCompleted);
list.patch('/items/:itemId', checkIds, validateBody(z.object({ text: itemText.optional(), ...itemFields })), itemsController.update);
list.put('/items/:itemId/completed', checkIds, validateBody(z.object({ completed: z.boolean() })), itemsController.setCompleted);
list.delete('/items/:itemId', checkIds, itemsController.remove);
list.post(
  '/items/:itemId/purchases',
  checkIds,
  validateBody(
    z.strictObject({
      id: z.uuid(),
      amount: z.number('AMOUNT_INVALID').positive('AMOUNT_INVALID').max(1_000_000, 'AMOUNT_INVALID').nullable().optional(),
      spent: z.number('SPENT_INVALID').min(0, 'SPENT_INVALID').max(10_000_000, 'SPENT_INVALID').nullable().optional(),
    }),
  ),
  itemsController.purchase,
);
