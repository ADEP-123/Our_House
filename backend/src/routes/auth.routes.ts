import { Router } from 'express';
import { z } from 'zod';
import { authController } from '../controllers/auth.controller.js';
import { profileController } from '../controllers/profile.controller.js';
import { passwordSchema } from '../lib/password.js';
import { emailSchema, localeSchema, nicknameSchema, timezoneSchema, tokenSchema } from '../lib/schemas.js';
import { requireAuth } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';

export const authRoutes = Router();

authRoutes.get('/nickname-available', authController.nicknameAvailable);

authRoutes.post(
  '/register',
  validateBody(
    z.object({
      email: emailSchema,
      nickname: nicknameSchema,
      password: passwordSchema,
      locale: localeSchema.default('es'),
      timezone: timezoneSchema.default('UTC'),
    }),
  ),
  authController.register,
);
authRoutes.post('/verify-email', validateBody(z.object({ token: tokenSchema })), authController.verifyEmail);
authRoutes.post('/resend-verification', validateBody(z.object({ email: emailSchema })), authController.resendVerification);
authRoutes.post(
  '/login',
  validateBody(z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) })),
  authController.login,
);
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', authController.logout);
authRoutes.post('/logout-all', requireAuth, authController.logoutAll);
authRoutes.post('/forgot-password', validateBody(z.object({ email: emailSchema })), authController.forgotPassword);
authRoutes.post(
  '/reset-password',
  validateBody(z.object({ token: tokenSchema, password: passwordSchema })),
  authController.resetPassword,
);
authRoutes.get('/me', requireAuth, authController.me);
// Enlace del correo de cambio de dirección: no exige sesión, el token prueba la propiedad del correo
authRoutes.post('/confirm-email-change', validateBody(z.object({ token: tokenSchema })), profileController.confirmEmailChange);
