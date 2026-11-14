import express, { Router } from 'express';
import { z } from 'zod';
import { itemsController } from '../controllers/items.controller.js';
import { profileController } from '../controllers/profile.controller.js';
import { MAX_AVATAR_BYTES, USER_AVATAR_PRESETS } from '../lib/avatars.js';
import { passwordSchema } from '../lib/password.js';
import { isSingleEmoji } from '../lib/lists.js';
import { PATTERN_CHOICES, PATTERN_INTENSITIES, THEME_PRESETS } from '../lib/themes.js';
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

// Mis tareas: lo asignado a mí en todos mis grupos
meRoutes.get('/tasks', itemsController.assignedToMe);

// Código de verificación al correo (para acciones sensibles)
meRoutes.post('/verification-codes', validateBody(z.strictObject({ purpose: z.enum(['secrets']) })), profileController.requestCode);

// Tutoriales: visto, saltado o en qué paso quedó (la práctica en sí nunca llega al servidor)
const TUTORIALS = ['lists', 'account', 'calendar', 'finance', 'getting-started'] as const;
meRoutes.put(
  '/tutorials/:tutorial',
  (req, _res, next) => {
    z.enum(TUTORIALS).parse(req.params.tutorial);
    next();
  },
  validateBody(
    z.strictObject({
      state: z.enum(['done', 'skipped', 'progress']),
      step: z.int().min(0).max(50).optional(),
    }),
  ),
  profileController.setTutorial,
);

// Preferencias de notificaciones (y más adelante recordatorios y calendario)
meRoutes.patch(
  '/settings',
  validateBody(
    z
      .strictObject({
        newLists: z.boolean(),
        assignments: z.boolean(),
        reminders: z.boolean(),
        reminderHour: z.int('REMINDER_HOUR_INVALID').min(0, 'REMINDER_HOUR_INVALID').max(23, 'REMINDER_HOUR_INVALID'),
        reminderStartDays: z.int('REMINDER_DAYS_INVALID').min(0, 'REMINDER_DAYS_INVALID').max(60, 'REMINDER_DAYS_INVALID'),
        reminderEveryDays: z.int('REMINDER_EVERY_INVALID').min(1, 'REMINDER_EVERY_INVALID').max(30, 'REMINDER_EVERY_INVALID'),
        calendarPromptDismissed: z.boolean(),
        secretViews: z.boolean(),
        finance: z.boolean(),
        scheduled: z.boolean(),
      })
      .partial()
      .refine((v) => Object.keys(v).length > 0, 'SETTINGS_EMPTY'),
  ),
  profileController.setSettings,
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

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'COLOR_INVALID').transform((v) => v.toLowerCase());
const themeSchema = z.object({
  preset: z.enum(THEME_PRESETS),
  colors: z.strictObject({
    primary: hex,
    onPrimary: hex,
    secondary: hex,
    background: hex,
    surface: hex,
    text: hex,
    success: hex,
    error: hex,
  }),
  /** Patrón de fondo: el del tema, ninguno, uno de la lista o un emoji propio */
  pattern: z
    .strictObject({
      id: z.enum(PATTERN_CHOICES),
      emoji: z.string().refine(isSingleEmoji, 'ICON_INVALID').optional(),
      intensity: z.enum(PATTERN_INTENSITIES),
    })
    .refine((p) => p.id !== 'emoji' || !!p.emoji, { message: 'ICON_INVALID', path: ['emoji'] })
    .transform((p) => (p.id === 'emoji' ? p : { id: p.id, intensity: p.intensity }))
    .optional(),
  /** Modo automático: el tema de la estación o fiesta de cada día */
  auto: z.strictObject({ enabled: z.boolean(), hemisphere: z.enum(['north', 'south']), dark: z.boolean() }).optional(),
});

meRoutes.put('/theme', validateBody(z.object({ theme: themeSchema.nullable() })), profileController.setTheme);

meRoutes.delete('/', validateBody(z.object({ password: z.string().min(1).max(128) })), profileController.deleteAccount);
