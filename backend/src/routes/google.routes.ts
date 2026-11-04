import { Router } from 'express';
import { googleController } from '../controllers/google.controller.js';
import { requireAuth } from '../middlewares/auth.js';

export const googleRoutes = Router();

// La vuelta desde Google llega sin la cookie de sesión (SameSite=Strict): se identifica por el "state" firmado
googleRoutes.get('/callback', googleController.callback);

googleRoutes.use(requireAuth);
googleRoutes.get('/status', googleController.status);
googleRoutes.post('/connect', googleController.connect);
googleRoutes.delete('/', googleController.disconnect);
