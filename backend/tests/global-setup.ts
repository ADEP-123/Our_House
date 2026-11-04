import pg from 'pg';
import { runMigrations } from '../src/db/migrator.js';

/**
 * Crea desde cero la base de pruebas y le aplica las migraciones.
 * TEST_DATABASE_URL debe apuntar a un PostgreSQL local o al servicio de CI, nunca a Neon.
 */
export default async function setup(): Promise<void> {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/ourhouse_test');
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  await runMigrations(url.toString(), () => undefined);
  process.env.TEST_DATABASE_URL = url.toString();
}
