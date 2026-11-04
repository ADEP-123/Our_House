import { waitUntil } from '@vercel/functions';

const pending = new Set<Promise<unknown>>();

/**
 * Trabajo que no debe demorar la respuesta (ej. enviar correos).
 * En Vercel, waitUntil mantiene viva la función hasta que termine. Un error solo queda en el log.
 */
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const promise: Promise<unknown> = task()
    .catch((err) => console.error(`[${label}]`, err))
    .finally(() => pending.delete(promise));
  pending.add(promise);
  waitUntil(promise);
}

/** Para las pruebas: espera a que termine todo lo pendiente. */
export async function settleBackground(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
