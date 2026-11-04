import express, { Router } from 'express';
import { z } from 'zod';
import { profileController } from '../controllers/profile.controller.js';
import { MAX_AVATAR_BYTES, USER_AVATAR_PRESETS } from '../lib/avatars.js';
import { passwordSchema } from '../lib/password.js';
import { emailSchema, localeSchema, nicknameSchema, timezoneSchema } from '../lib/schemas.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

/** Nombre o apellido opcional: vacío se guarda como null. */
const personName = z
  .string()
  .trim()
  .max(60, 'NAME_TOO_LONG')
  .transform((v) => v || null)
  .nullable();

export const meRoutes = Router();
meRoutes.use(requireAuth);

meRoutes.patch(
  '/',
  validateBody(
    z
      .object({
        firstName: personName,
        lastName: personName,
        nickname: nicknameSchema,
        locale: localeSchema,
        timezone: timezoneSchema,
      })
      .partial(),
  ),
  profileController.update,
);

meRoutes.put(
  '/password',
  validateBody(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })),
  profileController.changePassword,
);

meRoutes.post(
  '/email',
  validateBody(z.object({ newEmail: emailSchema, password: z.string().min(1).max(128) })),
  profileController.requestEmailChange,
);

// La imagen llega como cuerpo binario (sin multipart); el tipo real se valida por sus bytes
meRoutes.put(
  '/avatar',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: MAX_AVATAR_BYTES }),
  profileController.uploadAvatar,
);

meRoutes.put(
  '/avatar-preset',
  validateBody(z.object({ preset: z.enum(USER_AVATAR_PRESETS).nullable() })),
  profileController.setAvatarPreset,
);

meRoutes.delete('/', validateBody(z.object({ password: z.string().min(1).max(128) })), profileController.deleteAccount);
