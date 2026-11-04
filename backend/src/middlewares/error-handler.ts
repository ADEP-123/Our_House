import type { NextFunction, Request, Response } from 'express';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'No encontrado' });
}

// Express 5 envía aquí también los errores de handlers async
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
