import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

export const ACCESS_TTL_SECONDS = 15 * 60;

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

const secretKey = (): Uint8Array => new TextEncoder().encode(env.jwtSecret);

/** JWT de acceso de vida corta. La sesión larga vive en el refresh token (tabla sessions). */
export async function signAccessToken({ userId, sessionId }: AccessClaims): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
