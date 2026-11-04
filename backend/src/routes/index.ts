import { Router } from 'express';
import { authRoutes } from './auth.routes.js';
import { healthRoutes } from './health.routes.js';
import { meRoutes } from './me.routes.js';

/** Punto único donde se registran las rutas de cada módulo (tareas, calendario, finanzas...). */
export const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/me', meRoutes);
