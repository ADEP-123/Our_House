import { Router } from 'express';
import { z } from 'zod';
import { activityController } from '../controllers/activity.controller.js';
import { itemsController } from '../controllers/items.controller.js';
import { listsController, secretsController } from '../controllers/lists.controller.js';
import { LIST_COLORS, LIST_FEATURES, LIST_TYPES, SECRET_FIELD_KINDS, isListIcon } from '../lib/lists.js';
import { REPEAT_FREQS } from '../lib/recurrence.js';
import { checkIds } from '../lib/route-ids.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const listName = z.string().trim().min(1, 'LIST_NAME_REQUIRED').max(80, 'LIST_NAME_TOO_LONG');
/** Uno de los íconos con nombre o cualquier emoji */
const listIcon = z.string().trim().refine(isListIcon, 'ICON_INVALID');
/** Id generado por el cliente (opcional): permite crear sin conexión sin duplicar al reenviar */
const clientId = z.uuid().optional();
/** Opciones de los elementos (sin repetir); si no vienen al crear, las del tipo */
const features = z
  .array(z.enum(LIST_FEATURES, 'FEATURE_INVALID'))
  .max(LIST_FEATURES.length)
  .transform((f) => [...new Set(f)]);

/** /api/families/:familyId/lists */
export const familyListsRoutes = Router({ mergeParams: true });
familyListsRoutes.use(requireAuth, checkIds);
familyListsRoutes.get('/', listsController.listForFamily);
familyListsRoutes.get('/suggestions', listsController.suggestions);
familyListsRoutes.post(
  '/',
  validateBody(
    z.object({
      id: clientId,
      name: listName,
      type: z.enum(LIST_TYPES),
      color: z.enum(LIST_COLORS).default('blue'),
      icon: listIcon.default('check'),
      isPrivate: z.boolean().default(false),
      features: features.optional(),
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
      .object({ name: listName, color: z.enum(LIST_COLORS), icon: listIcon, isPrivate: z.boolean(), features })
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
  reminderStartDays: z.int('REMINDER_DAYS_INVALID').min(0, 'REMINDER_DAYS_INVALID').max(60, 'REMINDER_DAYS_INVALID').nullable().optional(),
  reminderEveryDays: z.int('REMINDER_EVERY_INVALID').min(1, 'REMINDER_EVERY_INVALID').max(30, 'REMINDER_EVERY_INVALID').nullable().optional(),
  remindersOff: z.boolean().optional(),
  description: optionalText(2000, 'ITEM_DESCRIPTION_TOO_LONG'),
  amount: z.number('AMOUNT_INVALID').positive('AMOUNT_INVALID').max(1_000_000, 'AMOUNT_INVALID').nullable().optional(),
  unit: optionalText(20, 'ITEM_UNIT_TOO_LONG'),
  category: optionalText(40, 'ITEM_CATEGORY_TOO_LONG'),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.iso.date('DUE_DATE_INVALID').nullable().optional(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'DUE_TIME_INVALID')
    .nullable()
    .optional(),
  position: z.number().finite().optional(),
  /** Repetición: el inicio lo pone el servidor (la fecha límite o hoy) */
  repeat: z
    .strictObject({
      freq: z.enum(REPEAT_FREQS, 'REPEAT_INVALID'),
      interval: z.int('REPEAT_INVALID').min(1, 'REPEAT_INVALID').max(365, 'REPEAT_INVALID').default(1),
      weekdays: z.array(z.int().min(0).max(6)).max(7).optional().transform((d) => (d?.length ? [...new Set(d)].sort() : undefined)),
      from: z.enum(['schedule', 'completion']).default('schedule'),
      until: z.iso.date('REPEAT_INVALID').optional(),
      count: z.int('REPEAT_INVALID').min(1, 'REPEAT_INVALID').max(999, 'REPEAT_INVALID').optional(),
    })
    .nullable()
    .optional(),
  /** Turnos: personas del grupo en orden */
  rotation: z.array(z.uuid()).max(20).nullable().optional(),
};
const itemText = z.string().trim().min(1, 'ITEM_TEXT_REQUIRED').max(200, 'ITEM_TEXT_TOO_LONG');

list.post(
  '/items',
  validateBody(z.object({ id: clientId, parentId: z.uuid().nullable().optional(), text: itemText, ...itemFields })),
  itemsController.create,
);
list.post('/reset', itemsController.uncheckAll);
list.post('/clear-completed', itemsController.deleteCompleted);
list.patch('/items/:itemId', checkIds, validateBody(z.object({ text: itemText.optional(), ...itemFields })), itemsController.update);
list.post('/items/:itemId/skip', checkIds, itemsController.skip);
list.put('/items/:itemId/completed', checkIds, validateBody(z.object({ completed: z.boolean() })), itemsController.setCompleted);
list.delete('/items/:itemId', checkIds, itemsController.remove);
// ---------- Listas secretas ----------
const secretTitle = z.string().trim().min(1, 'SECRET_TITLE_REQUIRED').max(120, 'SECRET_TITLE_TOO_LONG');
const secretFields = z
  .array(
    z.strictObject({
      label: z.string().trim().min(1, 'SECRET_LABEL_REQUIRED').max(40, 'SECRET_LABEL_TOO_LONG'),
      kind: z.enum(SECRET_FIELD_KINDS),
      value: z.string().max(2000, 'SECRET_VALUE_TOO_LONG'),
    }),
  )
  .max(20, 'SECRET_TOO_MANY_FIELDS');
list.post('/unlock', validateBody(z.strictObject({ code: z.string().regex(/^\d{6}$/, 'CODE_INVALID'), supervision: z.boolean().optional() })), secretsController.unlock);
list.get('/secrets', secretsController.reveal);
list.post('/secret-items', validateBody(z.strictObject({ id: clientId, title: secretTitle, fields: secretFields })), secretsController.create);
list.patch(
  '/secret-items/:itemId',
  checkIds,
  validateBody(z.strictObject({ title: secretTitle, fields: secretFields }).partial()),
  secretsController.update,
);
list.delete('/secret-items/:itemId', checkIds, secretsController.remove);

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

// Registrar pago: lo pagado en los artículos desde el último pago, en un solo movimiento
list.get('/payments', itemsController.payments);
list.post(
  '/payments',
  validateBody(
    z.strictObject({
      id: clientId,
      accountId: z.uuid('PAYMENT_ACCOUNT_INVALID').nullable(),
      categoryId: z.uuid('CATEGORY_NOT_FOUND').nullable().optional(),
      date: z.iso.date('DATE_INVALID').optional(),
    }),
  ),
  itemsController.registerPayment,
);
