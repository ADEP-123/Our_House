import type { NextFunction, Request, Response } from 'express';
import { notFound } from './http-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id mal formado en la URL responde 404 en vez de un error de PostgreSQL. */
export const checkIds = (req: Request, _res: Response, next: NextFunction): void => {
  for (const value of Object.values(req.params)) {
    if (!UUID.test(String(value))) throw notFound();
  }
  next();
};
