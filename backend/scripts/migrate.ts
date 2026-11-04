// Uso: npm run migrate  (lee DATABASE_URL de backend/.env o del entorno)
import { runMigrations } from '../src/db/migrator.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

runMigrations(url).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
