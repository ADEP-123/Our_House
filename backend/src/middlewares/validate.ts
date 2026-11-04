import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

/** Valida y normaliza el body con un esquema de zod. Los errores llegan al errorHandler como 400. */
export const validateBody =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
