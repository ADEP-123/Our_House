import { Router } from 'express';
import { accountsRoutes, familyAccountsRoutes } from './accounts.routes.js';
import { categoriesRoutes, familyCategoriesRoutes } from './categories.routes.js';
import { cronController } from '../controllers/cron.controller.js';
import { authRoutes } from './auth.routes.js';
import { familiesRoutes, invitationsRoutes } from './families.routes.js';
import { googleRoutes } from './google.routes.js';
import { healthRoutes } from './health.routes.js';
import { familyActivityRoutes, familyListsRoutes, listsRoutes } from './lists.routes.js';
import { meRoutes } from './me.routes.js';

/** Punto único donde se registran las rutas de cada módulo (tareas, calendario, finanzas...). */
export const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/me', meRoutes);
apiRouter.use('/families/:familyId/lists', familyListsRoutes);
apiRouter.use('/families/:familyId/activity', familyActivityRoutes);
apiRouter.use('/families/:familyId/accounts', familyAccountsRoutes);
apiRouter.use('/families/:familyId/categories', familyCategoriesRoutes);
apiRouter.use('/families', familiesRoutes);
apiRouter.use('/lists', listsRoutes);
apiRouter.use('/accounts', accountsRoutes);
apiRouter.use('/categories', categoriesRoutes);
apiRouter.use('/invitations', invitationsRoutes);
apiRouter.use('/google', googleRoutes);

// Tareas programadas (las dispara el workflow "Recordatorios" de GitHub cada hora)
apiRouter.post('/cron/reminders', cronController.reminders);
