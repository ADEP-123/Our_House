import { Router } from 'express';
import { z } from 'zod';
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
