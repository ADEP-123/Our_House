import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/http-error.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'NOT_FOUND' });
}

// Express 5 envía aquí también los errores de handlers async
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, ...err.details });
    return;
  }
  if (err instanceof ZodError) {
    // { campo: CODIGO } para que el formulario marque cada campo en el idioma del usuario
    const fields = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message]));
    res.status(400).json({ error: 'VALIDATION', fields });
    return;
  }
  // Límite de tamaño de express.json/express.raw (ej. avatar de más de 2 MB)
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'FILE_TOO_LARGE' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'INVALID_JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'INTERNAL' });
}
