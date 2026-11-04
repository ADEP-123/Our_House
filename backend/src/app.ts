import express from 'express';
import helmet from 'helmet';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFound } from './middlewares/error-handler.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás de Caddy
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);
  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}
