import { db, type Db } from '../config/database.js';

export interface SavingsProjectRow {
  id: string;
  family_id: string;
  name: string;
  icon: string;
  goal: number | null;
  target_date: string | null;
  created_by: string | null;
  created_by_nickname: string | null;
  closed_at: Date | null;
  goal_notified_at: Date | null;
  created_at: Date;
  /** Total gastado del ahorro (salidas pagadas con el proyecto) */
  spent: number;
}

export interface AllocationRow {
  project_id: string;
  account_id: string;
  amount: number;
}

export interface SavingsHistoryRow {
  kind: 'set_aside' | 'release' | 'spend';
  amount: number;
  account_id: string;
  actor_id: string | null;
  actor_nickname: string | null;
  description: string | null;
  date: string | null;
  at: Date;
}

export interface BudgetRow {
  category_id: string;
  name: string;
  icon: string;
  color: string;
  disabled: boolean;
  amount: number;
  spent: number;
}

const PROJECT_SELECT = `
  SELECT p.*, u.nickname AS created_by_nickname,
         COALESCE((SELECT sum(m.amount) FROM account_movements m WHERE m.savings_project_id = p.id AND m.deleted_at IS NULL), 0) AS spent
    FROM savings_projects p LEFT JOIN users u ON u.id = p.created_by`;

/**
 * Lo apartado de cada proyecto abierto en cada cuenta: apartado - liberado - gastado del ahorro (nunca negativo).
 * $1 = grupo
 */
const ALLOCATIONS = `
  SELECT x.project_id, x.account_id, GREATEST(0, sum(x.amount)) AS amount
    FROM (
      SELECT e.project_id, e.account_id, CASE WHEN e.kind = 'set_aside' THEN e.amount ELSE -e.amount END AS amount
        FROM savings_entries e
      UNION ALL
      SELECT m.savings_project_id, m.account_id, -m.amount
        FROM account_movements m
       WHERE m.savings_project_id IS NOT NULL AND m.deleted_at IS NULL
    ) x
    JOIN savings_projects p ON p.id = x.project_id
   WHERE p.family_id = $1 AND p.closed_at IS NULL
   GROUP BY x.project_id, x.account_id
  HAVING sum(x.amount) > 0`;

export const savingsRepository = {
  async listForFamily(familyId: string): Promise<SavingsProjectRow[]> {
    const { rows } = await db().query<SavingsProjectRow>(
      `${PROJECT_SELECT} WHERE p.family_id = $1 ORDER BY p.closed_at IS NOT NULL, p.created_at`,
      [familyId],
    );
    return rows;
  },

  async find(id: string, conn: Db = db()): Promise<SavingsProjectRow | null> {
    return (await conn.query<SavingsProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1`, [id])).rows[0] ?? null;
  },

  async allocations(familyId: string, conn: Db = db()): Promise<AllocationRow[]> {
    return (await conn.query<AllocationRow>(ALLOCATIONS, [familyId])).rows;
  },

  async create(
    p: { id: string; familyId: string; name: string; icon: string; goal: number | null; targetDate: string | null; createdBy: string },
  ): Promise<boolean> {
    const { rowCount } = await db().query(
      `INSERT INTO savings_projects (id, family_id, name, icon, goal, target_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.familyId, p.name, p.icon, p.goal, p.targetDate, p.createdBy],
    );
    return !!rowCount;
  },

  /** Al cambiar la meta, se vuelve a poder avisar que se cumplió */
  update: (id: string, f: { name: string; icon: string; goal: number | null; targetDate: string | null }) =>
    db().query(
      `UPDATE savings_projects
          SET name = $2, icon = $3, goal = $4, target_date = $5, updated_at = now(),
              goal_notified_at = CASE WHEN goal IS DISTINCT FROM $4 THEN NULL ELSE goal_notified_at END
        WHERE id = $1`,
      [id, f.name, f.icon, f.goal, f.targetDate],
    ),

  setClosed: (id: string, closed: boolean, conn: Db) =>
    conn.query('UPDATE savings_projects SET closed_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1', [id, closed]),

  delete: (id: string) => db().query('DELETE FROM savings_projects WHERE id = $1', [id]),

  addEntry: (e: { projectId: string; accountId: string; kind: 'set_aside' | 'release'; amount: number; actorId: string }, conn: Db = db()) =>
    conn.query('INSERT INTO savings_entries (project_id, account_id, kind, amount, actor_id) VALUES ($1, $2, $3, $4, $5)', [
      e.projectId,
      e.accountId,
      e.kind,
      e.amount,
      e.actorId,
    ]),

  /** Marca el aviso de meta cumplida; devuelve false si ya se había avisado */
  async markGoalNotified(id: string): Promise<boolean> {
    const { rowCount } = await db().query(
      'UPDATE savings_projects SET goal_notified_at = now() WHERE id = $1 AND goal_notified_at IS NULL',
      [id],
    );
    return !!rowCount;
  },

  /** Apartar, liberar y gastar del ahorro, del más reciente al más antiguo */
  async history(projectId: string): Promise<SavingsHistoryRow[]> {
    const { rows } = await db().query<SavingsHistoryRow>(
      `SELECT * FROM (
         SELECT e.kind, e.amount, e.account_id, e.actor_id, u.nickname AS actor_nickname, NULL AS description, NULL::date AS date, e.created_at AS at
           FROM savings_entries e LEFT JOIN users u ON u.id = e.actor_id
          WHERE e.project_id = $1
         UNION ALL
         SELECT 'spend', m.amount, m.account_id, m.created_by, u.nickname, m.description, m.date, m.created_at
           FROM account_movements m LEFT JOIN users u ON u.id = m.created_by
          WHERE m.savings_project_id = $1 AND m.deleted_at IS NULL
       ) h ORDER BY at DESC LIMIT 200`,
      [projectId],
    );
    return rows;
  },

  // ---------- Presupuesto ----------

  /**
   * Presupuestos del grupo con lo gastado en el mes ('YYYY-MM'):
   * salidas de esa categoría en las cuentas del grupo que no son privadas.
   */
  async budgets(familyId: string, month: string, conn: Db = db()): Promise<BudgetRow[]> {
    const { rows } = await conn.query<BudgetRow>(
      `SELECT c.id AS category_id, c.name, c.icon, c.color, c.disabled_at IS NOT NULL AS disabled, b.amount,
              COALESCE((
                SELECT sum(m.amount) FROM account_movements m JOIN accounts a ON a.id = m.account_id
                 WHERE m.category_id = c.id AND m.kind = 'out' AND m.deleted_at IS NULL AND a.view_mode <> 'private'
                   AND m.date >= ($2 || '-01')::date AND m.date < ($2 || '-01')::date + interval '1 month'
              ), 0) AS spent
         FROM category_budgets b JOIN movement_categories c ON c.id = b.category_id
        WHERE c.family_id = $1
        ORDER BY lower(c.name)`,
      [familyId, month],
    );
    return rows;
  },

  setBudget: (categoryId: string, amount: number, userId: string) =>
    db().query(
      `INSERT INTO category_budgets (category_id, amount, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (category_id) DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [categoryId, amount, userId],
    ),

  removeBudget: (categoryId: string) => db().query('DELETE FROM category_budgets WHERE category_id = $1', [categoryId]),

  /** Registra el aviso (80 o 100 %); devuelve false si ya se había enviado este mes */
  async claimBudgetAlert(categoryId: string, month: string, threshold: 80 | 100): Promise<boolean> {
    const { rowCount } = await db().query(
      'INSERT INTO budget_alerts (category_id, month, threshold) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [categoryId, month, threshold],
    );
    return !!rowCount;
  },

  // ---------- Disponible bajo ----------

  /** Cuentas con umbral: saldo, ahorro apartado, umbral y si ya se avisó */
  async thresholds(accountIds: string[]) {
    const { rows } = await db().query<{
      id: string;
      family_id: string;
      name: string;
      owner_id: string | null;
      threshold: number;
      notified: boolean;
      balance: number;
    }>(
      `SELECT a.id, a.family_id, a.name, a.owner_id, a.low_balance_threshold AS threshold, a.low_balance_notified_at IS NOT NULL AS notified,
              COALESCE((SELECT sum(CASE WHEN m.kind IN ('out', 'transfer_out') THEN -m.amount ELSE m.amount END)
                          FROM account_movements m WHERE m.account_id = a.id AND m.deleted_at IS NULL), 0) AS balance
         FROM accounts a
        WHERE a.id = ANY($1::uuid[]) AND a.low_balance_threshold IS NOT NULL AND a.archived_at IS NULL`,
      [accountIds],
    );
    return rows;
  },

  setLowBalanceNotified: (accountId: string, notified: boolean) =>
    db().query('UPDATE accounts SET low_balance_notified_at = CASE WHEN $2 THEN now() END WHERE id = $1', [accountId, notified]),
};
