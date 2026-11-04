// Solo para desarrollo local o un servidor propio. En Vercel la entrada es app.ts.
import app from './app.js';
import { env } from './config/env.js';
import { closePool } from './config/database.js';

const server = app.listen(env.port, () => {
  console.log(`API escuchando en el puerto ${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} recibido, cerrando...`);
  server.close();
  await closePool().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
