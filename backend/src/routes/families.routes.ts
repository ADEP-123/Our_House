import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { familiesController } from '../controllers/families.controller.js';
import { FAMILY_AVATAR_PRESETS, MAX_AVATAR_BYTES } from '../lib/avatars.js';
import { notFound } from '../lib/http-error.js';
import { emailSchema, nicknameSchema } from '../lib/schemas.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

const familyName = z.string().trim().min(1, 'FAMILY_NAME_REQUIRED').max(60, 'FAMILY_NAME_TOO_LONG');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id mal formado responde 404 en vez de un error de PostgreSQL. */
const checkIds = (req: Request, _res: Response, next: NextFunction): void => {
  for (const name of ['familyId', 'userId', 'invitationId']) {
    const value = req.params[name];
    if (value !== undefined && !UUID.test(String(value))) throw notFound();
  }
  next();
};

export const familiesRoutes = Router();
familiesRoutes.use(requireAuth);

familiesRoutes.get('/', familiesController.list);
familiesRoutes.post('/', validateBody(z.object({ name: familyName })), familiesController.create);
familiesRoutes.post(
  '/join',
  validateBody(z.object({ code: z.string().trim().min(4).max(20) })),
  familiesController.join,
);

const family = Router({ mergeParams: true });
familiesRoutes.use('/:familyId', checkIds, family);

family.get('/', familiesController.detail);
family.patch(
  '/',
  validateBody(
    z
      .strictObject({
        name: familyName,
        // Código ISO 4217 (USD, EUR, COP...); el frontend ofrece los que conoce el navegador
        currency: z.string().regex(/^[A-Z]{3}$/, 'CURRENCY_INVALID'),
      })
      .partial()
      .refine((v) => Object.keys(v).length > 0, 'NOTHING_TO_UPDATE'),
  ),
  familiesController.update,
);
family.put(
  '/avatar',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: MAX_AVATAR_BYTES }),
  familiesController.uploadAvatar,
);
family.put(
  '/avatar-preset',
  validateBody(z.object({ preset: z.enum(FAMILY_AVATAR_PRESETS).nullable() })),
  familiesController.setAvatarPreset,
);
family.post('/invite-code', familiesController.regenerateCode);
family.post('/leave', familiesController.leave);
family.patch(
  '/members/:userId',
  checkIds,
  validateBody(z.object({ role: z.enum(['leader', 'member', 'supervised']) })),
  familiesController.setRole,
);
family.delete('/members/:userId', checkIds, familiesController.expel);

family.get('/invitations', familiesController.listInvitations);
family.post(
  '/invitations',
  // Un correo o un apodo
  validateBody(z.object({ target: z.union([emailSchema, nicknameSchema], { error: 'INVITE_TARGET_INVALID' }) })),
  familiesController.invite,
);
family.post('/invitations/:invitationId/resend', checkIds, familiesController.resendInvitation);
family.delete('/invitations/:invitationId', checkIds, familiesController.cancelInvitation);

/** Invitaciones que recibió el usuario */
export const invitationsRoutes = Router();
invitationsRoutes.use(requireAuth);
invitationsRoutes.get('/', familiesController.myInvitations);
invitationsRoutes.post('/:invitationId/accept', checkIds, familiesController.accept);
invitationsRoutes.post('/:invitationId/reject', checkIds, familiesController.reject);
