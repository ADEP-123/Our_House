import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { scheduledService } from '../services/scheduled.service.js';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { calendarService } from '../services/calendar.service.js';
import { reopenDueItems } from '../services/repeat.service.js';
import { remindersService } from '../services/reminders.service.js';

/** Solo quien tiene CRON_SECRET (el workflow de GitHub) puede disparar los envíos programados. */
function requireCronSecret(req: Request): void {
  if (!env.cronSecret) throw new HttpError(503, 'CRON_DISABLED');
  const given = Buffer.from(req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(env.cronSecret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'UNAUTHENTICATED');
}

export const cronController = {
  async reminders(req: Request, res: Response): Promise<void> {
    requireCronSecret(req);
    // Lo que se repite sin fecha vuelve a pendiente cuando le toca
    await reopenDueItems();
    const reminders = await remindersService.run();
    // Finanzas: movimientos programados que tocan hoy y sus avisos previos
    const scheduled = await scheduledService.run().catch((err) => {
      console.error('[programados] proceso', err);
      return { scheduled: 0 };
    });
    // De paso, el calendario: borra eventos de tareas eliminadas y reintenta lo que falló
    await calendarService.reconcile().catch((err) => console.error('[calendario] repaso', err));
    res.json({ ...reminders, ...scheduled });
  },
};
