import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { env } from './env.js';

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

/** Presta un cliente del pool y lo devuelve siempre, aunque falle la consulta. */
export async function withConnection<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
