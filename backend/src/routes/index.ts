import { Router } from 'express';
import { healthRoutes } from './health.routes.js';

/** Punto único donde se registran las rutas de cada módulo (tareas, calendario, finanzas...). */
export const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
