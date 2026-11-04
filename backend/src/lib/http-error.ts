/**
 * Error con código estable. El frontend traduce `code` al idioma del usuario,
 * así la API no devuelve textos en un idioma fijo.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const badRequest = (code: string, details?: Record<string, unknown>) => new HttpError(400, code, details);
export const unauthorized = (code = 'UNAUTHENTICATED') => new HttpError(401, code);
export const forbidden = (code = 'FORBIDDEN', details?: Record<string, unknown>) => new HttpError(403, code, details);
export const notFound = (code = 'NOT_FOUND') => new HttpError(404, code);
export const conflict = (code: string) => new HttpError(409, code);
