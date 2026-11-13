import { db } from '../config/database.js';
import type { SummaryMovement } from '../lib/summary.js';

export const summaryRepository = {
  /** Movimientos vigentes de las cuentas hasta la fecha (para saldos y totales) */
  async movements(accountIds: string[], to: string): Promise<SummaryMovement[]> {
    const { rows } = await db().query<SummaryMovement>(
      `SELECT account_id, kind, amount, date, category_id
         FROM account_movements
        WHERE account_id = ANY($1::uuid[]) AND deleted_at IS NULL AND date <= $2
        ORDER BY date, created_at, number`,
      [accountIds, to],
    );
    return rows;
  },

  async prefs(familyId: string, userId: string): Promise<unknown | null> {
    const { rows } = await db().query<{ config: unknown }>(
      'SELECT config FROM finance_summary_prefs WHERE family_id = $1 AND user_id = $2',
      [familyId, userId],
    );
    return rows[0]?.config ?? null;
  },

  setPrefs: (familyId: string, userId: string, config: unknown) =>
    db().query(
      `INSERT INTO finance_summary_prefs (family_id, user_id, config) VALUES ($1, $2, $3)
       ON CONFLICT (family_id, user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
      [familyId, userId, JSON.stringify(config)],
    ),
};
