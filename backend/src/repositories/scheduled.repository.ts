import { db, type Db } from '../config/database.js';
import type { RepeatRule } from '../lib/recurrence.js';

export type ScheduledKind = 'in' | 'out' | 'transfer' | 'set_aside';
export type PauseReason = 'manual' | 'archived' | 'permission' | 'missing';

export interface ScheduledRow {
  id: string;
  family_id: string;
  account_id: string;
  kind: ScheduledKind;
  to_account_id: string | null;
  savings_project_id: string | null;
  category_id: string | null;
  amount: number;
  description: string;
  mode: 'auto' | 'confirm';
  rule: RepeatRule;
  next_date: string | null;
  times_done: number;
  remind_days: number | null;
  notify_done: boolean;
  last_reminded_for: string | null;
  paused_at: Date | null;
  pause_reason: PauseReason | null;
  ended_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

/** Con nombres para mostrar */
export interface ScheduledViewRow extends ScheduledRow {
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  project_name: string | null;
  project_icon: string | null;
  created_by_nickname: string | null;
}

/** Programado que toca, con quien lo creó (su zona horaria, idioma y correo) */
export interface DueRow extends ScheduledRow {
  account_name: string;
  to_account_name: string | null;
  timezone: string;
  locale: 'es' | 'en';
  email: string | null;
  can_email: boolean;
  currency: string;
}

export interface OccurrenceRow {
  id: string;
  schedule_id: string;
  due_date: string;
  status: 'done' | 'pending' | 'skipped' | 'failed';
  amount: number | null;
  movement_id: string | null;
}

export interface ScheduledInput {
  id: string;
  familyId: string;
  accountId: string;
  kind: ScheduledKind;
  toAccountId: string | null;
  savingsProjectId: string | null;
  categoryId: string | null;
  amount: number;
  description: string;
  mode: 'auto' | 'confirm';
  rule: RepeatRule;
  nextDate: string | null;
  remindDays: number | null;
  notifyDone: boolean;
}

const VIEW = `
  SELECT s.*, a.name AS account_name, t.name AS to_account_name,
         c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         p.name AS project_name, p.icon AS project_icon, u.nickname AS created_by_nickname
    FROM scheduled_movements s
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN accounts t ON t.id = s.to_account_id
    LEFT JOIN movement_categories c ON c.id = s.category_id
    LEFT JOIN savings_projects p ON p.id = s.savings_project_id
    LEFT JOIN users u ON u.id = s.created_by`;

export const scheduledRepository = {
  async listForFamily(familyId: string): Promise<ScheduledViewRow[]> {
    const { rows } = await db().query<ScheduledViewRow>(
      `${VIEW} WHERE s.family_id = $1 ORDER BY s.ended_at IS NOT NULL, s.next_date NULLS LAST, s.created_at`,
      [familyId],
    );
    return rows;
  },

  async find(id: string, conn: Db = db()): Promise<ScheduledViewRow | null> {
    return (await conn.query<ScheduledViewRow>(`${VIEW} WHERE s.id = $1`, [id])).rows[0] ?? null;
  },

  async create(s: ScheduledInput, userId: string): Promise<boolean> {
    const { rowCount } = await db().query(
      `INSERT INTO scheduled_movements (id, family_id, account_id, kind, to_account_id, savings_project_id, category_id, amount,
                                        description, mode, rule, next_date, remind_days, notify_done, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.familyId, s.accountId, s.kind, s.toAccountId, s.savingsProjectId, s.categoryId, s.amount, s.description, s.mode,
       JSON.stringify(s.rule), s.nextDate, s.remindDays, s.notifyDone, userId],
    );
    return !!rowCount;
  },

  /** Cambiar el programado: la próxima fecha se recalcula y, si había terminado, vuelve a estar activo */
  update: (s: ScheduledInput) =>
    db().query(
      `UPDATE scheduled_movements
          SET account_id = $2, kind = $3, to_account_id = $4, savings_project_id = $5, category_id = $6, amount = $7,
              description = $8, mode = $9, rule = $10, next_date = $11, remind_days = $12, notify_done = $13,
              ended_at = CASE WHEN $11::date IS NULL THEN COALESCE(ended_at, now()) END,
              last_reminded_for = NULL, updated_at = now()
        WHERE id = $1`,
      [s.id, s.accountId, s.kind, s.toAccountId, s.savingsProjectId, s.categoryId, s.amount, s.description, s.mode,
       JSON.stringify(s.rule), s.nextDate, s.remindDays, s.notifyDone],
    ),

  delete: (id: string) => db().query('DELETE FROM scheduled_movements WHERE id = $1', [id]),

  setPaused: (id: string, reason: PauseReason | null, nextDate?: string | null) =>
    db().query(
      `UPDATE scheduled_movements
          SET paused_at = CASE WHEN $2::text IS NULL THEN NULL ELSE COALESCE(paused_at, now()) END,
              pause_reason = $2, next_date = CASE WHEN $3::boolean THEN $4::date ELSE next_date END, updated_at = now()
        WHERE id = $1`,
      [id, reason, nextDate !== undefined, nextDate ?? null],
    ),

  /** Avanza a la próxima fecha (o termina) */
  advance: (id: string, next: string | null, timesDone: number, conn: Db = db()) =>
    conn.query(
      `UPDATE scheduled_movements
          SET next_date = $2, times_done = $3, ended_at = CASE WHEN $2::date IS NULL THEN now() END, updated_at = now()
        WHERE id = $1`,
      [id, next, timesDone],
    ),

  markReminded: (id: string, date: string) => db().query('UPDATE scheduled_movements SET last_reminded_for = $2 WHERE id = $1', [id, date]),

  /**
   * Activos con algo para hoy en alguna zona horaria: los que tocan (next_date) o su aviso previo.
   * $1 = el día más adelantado posible (UTC + 14 h)
   */
  async active(maxDate: string): Promise<DueRow[]> {
    const { rows } = await db().query<DueRow>(
      `SELECT s.*, a.name AS account_name, t.name AS to_account_name, u.timezone, u.locale, u.email, f.currency,
              (u.email_scheduled AND u.email_verified_at IS NOT NULL) AS can_email
         FROM scheduled_movements s
         JOIN accounts a ON a.id = s.account_id
         LEFT JOIN accounts t ON t.id = s.to_account_id
         JOIN families f ON f.id = s.family_id
         LEFT JOIN users u ON u.id = s.created_by
        WHERE s.paused_at IS NULL AND s.ended_at IS NULL AND s.next_date IS NOT NULL
          AND (s.next_date <= $1 OR (s.remind_days IS NOT NULL AND s.next_date - s.remind_days <= $1::date))`,
      [maxDate],
    );
    return rows;
  },

  // ---------- Ocurrencias ----------

  /** Registra una ocurrencia; false si esa fecha ya estaba registrada (el proceso no duplica) */
  async addOccurrence(
    o: { scheduleId: string; dueDate: string; status: OccurrenceRow['status']; amount: number | null; movementId?: string | null; userId?: string | null },
    conn: Db = db(),
  ): Promise<boolean> {
    const { rowCount } = await conn.query(
      `INSERT INTO scheduled_occurrences (schedule_id, due_date, status, amount, movement_id, resolved_by, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'pending' THEN NULL ELSE now() END)
       ON CONFLICT (schedule_id, due_date) DO NOTHING`,
      [o.scheduleId, o.dueDate, o.status, o.amount, o.movementId ?? null, o.userId ?? null],
    );
    return !!rowCount;
  },

  /** Ajusta una ocurrencia ya reservada (ej. registrada con su movimiento, o fallida) */
  setOccurrence: (scheduleId: string, dueDate: string, status: OccurrenceRow['status'], movementId: string | null) =>
    db().query('UPDATE scheduled_occurrences SET status = $3, movement_id = $4, resolved_at = now() WHERE schedule_id = $1 AND due_date = $2', [
      scheduleId,
      dueDate,
      status,
      movementId,
    ]),

  /** Se pausó antes de registrar: la fecha queda libre para cuando se reanude */
  deleteOccurrence: (scheduleId: string, dueDate: string) =>
    db().query('DELETE FROM scheduled_occurrences WHERE schedule_id = $1 AND due_date = $2', [scheduleId, dueDate]),

  async pending(familyId: string) {
    const { rows } = await db().query<OccurrenceRow>(
      `SELECT o.* FROM scheduled_occurrences o JOIN scheduled_movements s ON s.id = o.schedule_id
        WHERE s.family_id = $1 AND o.status = 'pending' ORDER BY o.due_date`,
      [familyId],
    );
    return rows;
  },

  async findOccurrence(id: string): Promise<OccurrenceRow | null> {
    return (await db().query<OccurrenceRow>('SELECT * FROM scheduled_occurrences WHERE id = $1', [id])).rows[0] ?? null;
  },

  resolveOccurrence: (id: string, status: 'done' | 'skipped', amount: number | null, movementId: string | null, userId: string) =>
    db().query(
      `UPDATE scheduled_occurrences SET status = $2, amount = COALESCE($3, amount), movement_id = $4, resolved_by = $5, resolved_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, status, amount, movementId, userId],
    ),

  /** Marca los movimientos creados por el programado */
  linkMovements: (movementIds: string[], scheduleId: string) =>
    db().query('UPDATE account_movements SET schedule_id = $2 WHERE id = ANY($1::uuid[])', [movementIds, scheduleId]),

  /**
   * Posibles suscripciones: salidas con la misma descripción en la misma cuenta en al menos 3 de los últimos 6 meses,
   * sin un programado con esa descripción. Devuelve el último monto, la categoría y el día del mes más común.
   */
  async suggestions(accountIds: string[], since: string) {
    const { rows } = await db().query<{
      account_id: string;
      description: string;
      category_id: string | null;
      amount: number;
      day: number;
      months: number;
    }>(
      `WITH outs AS (
         SELECT m.account_id, lower(m.description) AS key, m.description, m.category_id, m.amount, m.date
           FROM account_movements m
          WHERE m.account_id = ANY($1::uuid[]) AND m.kind = 'out' AND m.deleted_at IS NULL AND m.date >= $2 AND m.schedule_id IS NULL
       )
       SELECT o.account_id, (array_agg(o.description ORDER BY o.date DESC))[1] AS description,
              (array_agg(o.category_id ORDER BY o.date DESC))[1] AS category_id,
              (array_agg(o.amount ORDER BY o.date DESC))[1] AS amount,
              mode() WITHIN GROUP (ORDER BY extract(day FROM o.date)::int) AS day,
              count(DISTINCT date_trunc('month', o.date))::int AS months
         FROM outs o
        WHERE NOT EXISTS (
          SELECT 1 FROM scheduled_movements s WHERE s.account_id = o.account_id AND lower(s.description) = o.key AND s.ended_at IS NULL
        )
        GROUP BY o.account_id, o.key
       HAVING count(DISTINCT date_trunc('month', o.date)) >= 3
        ORDER BY months DESC, amount DESC
        LIMIT 8`,
      [accountIds, since],
    );
    return rows;
  },
};
