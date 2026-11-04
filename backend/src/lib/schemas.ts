import { z } from 'zod';

/** Reglas de validación compartidas por varias rutas. Los mensajes son códigos que traduce el frontend. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('EMAIL_INVALID')).pipe(z.string().max(254));

export const nicknameSchema = z
  .string()
  .trim()
  .min(3, 'NICKNAME_TOO_SHORT')
  .max(30, 'NICKNAME_TOO_LONG')
  .regex(/^[\p{L}\p{N}_.-]+$/u, 'NICKNAME_INVALID');

export const localeSchema = z.enum(['es', 'en']);

export const timezoneSchema = z
  .string()
  .refine((tz) => tz === 'UTC' || Intl.supportedValuesOf('timeZone').includes(tz), 'TIMEZONE_INVALID');

export const tokenSchema = z.string().min(20).max(100);
