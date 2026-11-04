import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool, initPool } from './config/database.js';

try {
  await initPool();
  console.log('Pool de Oracle listo');
} catch (err) {
  // La API arranca igual; /api/health reportará db: "down" hasta que la base responda
  console.error('No se pudo crear el pool de Oracle:', (err as Error).message);
}

const server = createApp().listen(env.port, () => {
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
