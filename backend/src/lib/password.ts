import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

/** Mismas reglas que muestra el formulario: mínimo 10 caracteres, al menos una letra y un número. */
export const passwordSchema = z
  .string()
  .min(10, 'PASSWORD_TOO_SHORT')
  .max(128, 'PASSWORD_TOO_LONG')
  .regex(/\p{L}/u, 'PASSWORD_NEEDS_LETTER')
  .regex(/\p{N}/u, 'PASSWORD_NEEDS_NUMBER');

export const hashPassword = (password: string): Promise<string> => hash(password);

export const verifyPassword = (passwordHash: string, password: string): Promise<boolean> =>
  verify(passwordHash, password).catch(() => false);
