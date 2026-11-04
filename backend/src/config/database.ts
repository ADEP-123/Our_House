import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { env } from './env.js';

// Las columnas DATE llegan como texto 'AAAA-MM-DD' (sin convertirlas a medianoche de la zona del servidor)
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// NUMERIC (cantidades y montos) como número: los valores de la app caben sin perder precisión
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

let pool: pg.Pool | undefined;

/** Crea el pool la primera vez que se necesita, así la API arranca aunque falte DATABASE_URL. */
function getPool(): pg.Pool {
  if (pool) return pool;
  if (!env.db.url) throw new Error('Falta DATABASE_URL');

  pool = new pg.Pool({
    connectionString: env.db.url,
    max: env.db.poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  // En Vercel cierra las conexiones ociosas antes de suspender la función; fuera de Vercel no hace nada
  attachDatabasePool(pool);
  return pool;
}

/** Cliente o pool: los repositorios aceptan cualquiera de los dos para poder usarse dentro de transacciones. */
export type Db = pg.Pool | pg.PoolClient;

export function db(): Db {
  return getPool();
}

/** Presta un cliente del pool y lo devuelve siempre, aunque falle la consulta. */
export async function withConnection<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

/** Ejecuta varias operaciones como una sola: si algo falla, no se guarda nada. */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withConnection(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
