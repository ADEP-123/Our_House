import { createHash, randomBytes } from 'node:crypto';

/** Token aleatorio para enlaces de correo y sesiones. En la base solo se guarda su hash. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const addMs = (ms: number, from = new Date()): Date => new Date(from.getTime() + ms);
