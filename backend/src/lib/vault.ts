import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from './http-error.js';

/**
 * Cifrado de la información secreta.
 *
 * - Clave maestra: 32 bytes aleatorios en la variable SECRETS_KEY (base64). No está en la base de datos ni en el repo.
 * - Cada elemento usa una clave propia: HKDF-SHA256(clave maestra, salt aleatorio del elemento, lista y elemento).
 *   Conocer un elemento cifrado y su contenido no revela la clave maestra ni la de otros elementos.
 * - AES-256-GCM con vector aleatorio. La lista y el elemento van como dato autenticado:
 *   un valor copiado a otra fila deja de descifrarse.
 *
 * Formato guardado: v1.<salt>.<iv>.<tag>.<cifrado> (base64url). "v1" permite rotar la clave más adelante.
 */
const VERSION = 'v1';

let devWarned = false;

function masterKey(): Buffer {
  if (env.secretsKey) {
    const key = Buffer.from(env.secretsKey, 'base64');
    if (key.length !== 32) throw new HttpError(503, 'SECRETS_NOT_CONFIGURED');
    return key;
  }
  // En producción sin clave, las listas secretas no funcionan; en desarrollo se usa una derivada para probar
  if (env.isProduction) throw new HttpError(503, 'SECRETS_NOT_CONFIGURED');
  if (!devWarned) {
    console.warn('[vault] SECRETS_KEY no definida: se usa una clave de desarrollo');
    devWarned = true;
  }
  return createHash('sha256').update(`dev-secrets:${env.jwtSecret}`).digest();
}

const context = (listId: string, itemId: string) => `our-house/secret-item/${listId}/${itemId}`;
const b64 = (b: Buffer) => b.toString('base64url');

function itemKey(salt: Buffer, listId: string, itemId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey(), salt, context(listId, itemId), 32));
}

export function sealItem(listId: string, itemId: string, plain: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', itemKey(salt, listId, itemId), iv);
  cipher.setAAD(Buffer.from(context(listId, itemId)));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, b64(salt), b64(iv), b64(cipher.getAuthTag()), b64(data)].join('.');
}

export function openItem(listId: string, itemId: string, sealed: string): string {
  const [version, salt, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !salt || !iv || !tag || data === undefined) throw new Error('Formato de secreto desconocido');
  const decipher = createDecipheriv('aes-256-gcm', itemKey(Buffer.from(salt, 'base64url'), listId, itemId), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context(listId, itemId)));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
