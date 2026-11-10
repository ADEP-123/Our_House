import { db, type Db } from '../config/database.js';

export interface CategoryRow {
  id: string;
  family_id: string;
  name: string;
  icon: string;
  color: string;
  disabled_at: Date | null;
  created_at: Date;
  /** Movimientos con esta categoría (en todas las cuentas del grupo) */
  usage: number;
}

/** Movimiento con su cuenta, para elegir a dónde pasarlo antes de borrar la categoría */
export interface CategoryMovementRow {
  id: string;
  account_id: string;
  account_name: string;
  prefix: string;
  number: number;
  kind: 'opening' | 'in' | 'out';
  amount: number;
  date: string;
  description: string;
}

const SELECT = `
  SELECT c.*, (SELECT count(*)::int FROM account_movements m WHERE m.category_id = c.id) AS usage
    FROM movement_categories c`;

export const categoriesRepository = {
  async listForFamily(familyId: string, conn: Db = db()): Promise<CategoryRow[]> {
    const { rows } = await conn.query<CategoryRow>(`${SELECT} WHERE c.family_id = $1 ORDER BY lower(c.name)`, [familyId]);
    return rows;
  },

  async find(id: string, conn: Db = db()): Promise<CategoryRow | null> {
    return (await conn.query<CategoryRow>(`${SELECT} WHERE c.id = $1`, [id])).rows[0] ?? null;
  },

  async nameTaken(familyId: string, name: string, exceptId: string | null, conn: Db = db()): Promise<boolean> {
    const { rowCount } = await conn.query(
      'SELECT 1 FROM movement_categories WHERE family_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3',
      [familyId, name, exceptId],
    );
    return !!rowCount;
  },

  /** Crea la categoría; si el id ya existe (reenvío) no hace nada. */
  async create(
    data: { id: string; familyId: string; name: string; icon: string; color: string; createdBy: string | null },
    conn: Db = db(),
  ): Promise<void> {
    await conn.query(
      `INSERT INTO movement_categories (id, family_id, name, icon, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [data.id, data.familyId, data.name, data.icon, data.color, data.createdBy],
    );
  },

  async update(id: string, data: { name?: string; icon?: string; color?: string; disabled?: boolean }): Promise<void> {
    await db().query(
      `UPDATE movement_categories SET
         name = COALESCE($2, name),
         icon = COALESCE($3, icon),
         color = COALESCE($4, color),
         disabled_at = CASE WHEN $5::boolean IS NULL THEN disabled_at WHEN $5 THEN COALESCE(disabled_at, now()) END,
         updated_at = now()
       WHERE id = $1`,
      [id, data.name ?? null, data.icon ?? null, data.color ?? null, data.disabled ?? null],
    );
  },

  /** Marca el grupo como sembrado; devuelve true solo la primera vez (evita sembrar dos veces en paralelo). */
  async claimSeed(familyId: string, conn: Db): Promise<boolean> {
    const { rowCount } = await conn.query(
      'UPDATE families SET categories_seeded = true WHERE id = $1 AND NOT categories_seeded',
      [familyId],
    );
    return !!rowCount;
  },

  async movements(categoryId: string): Promise<CategoryMovementRow[]> {
    const { rows } = await db().query<CategoryMovementRow>(
      `SELECT m.id, m.account_id, a.name AS account_name, a.prefix, m.number, m.kind, m.amount, m.date, m.description
         FROM account_movements m JOIN accounts a ON a.id = m.account_id
        WHERE m.category_id = $1
        ORDER BY m.date DESC, m.created_at DESC`,
      [categoryId],
    );
    return rows;
  },

  /** Pasa los movimientos indicados a otra categoría (solo los que siguen en la categoría de origen). */
  async moveMovements(fromId: string, movementIds: string[], toId: string, conn: Db): Promise<void> {
    await conn.query(
      'UPDATE account_movements SET category_id = $3, updated_at = now() WHERE category_id = $1 AND id = ANY($2::uuid[])',
      [fromId, movementIds, toId],
    );
  },

  async moveAll(fromId: string, toId: string, conn: Db): Promise<void> {
    await conn.query('UPDATE account_movements SET category_id = $2, updated_at = now() WHERE category_id = $1', [fromId, toId]);
  },

  delete: (id: string, conn: Db) => conn.query('DELETE FROM movement_categories WHERE id = $1', [id]),
};
