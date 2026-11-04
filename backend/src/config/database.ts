import oracledb from 'oracledb';
import { env } from './env.js';

let pool: oracledb.Pool | undefined;

/** Crea el pool de conexiones (modo thin, sin Oracle Client instalado). */
export async function initPool(): Promise<void> {
  const { user, password, connectString, walletDir, walletPassword, poolMax } = env.db;
  if (!user || !password || !connectString) {
    throw new Error('Faltan DB_USER, DB_PASSWORD o DB_CONNECT_STRING');
  }

  pool = await oracledb.createPool({
    user,
    password,
    connectString,
    // Solo aplica con wallet (mTLS); con TLS simple quedan undefined
    configDir: walletDir,
    walletLocation: walletDir,
    walletPassword,
    poolMin: 0,
    poolMax,
    poolIncrement: 1,
  });
}

/** Presta una conexión del pool y la devuelve siempre, aunque falle la consulta. */
export async function withConnection<T>(work: (conn: oracledb.Connection) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('El pool de Oracle no está inicializado');
  const conn = await pool.getConnection();
  try {
    return await work(conn);
  } finally {
    await conn.close();
  }
}

export async function closePool(): Promise<void> {
  await pool?.close(10);
  pool = undefined;
}
