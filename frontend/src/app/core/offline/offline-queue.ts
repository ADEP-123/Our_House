import { HttpClient } from '@angular/common/http';
import { effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { isNetworkError, isRetryable } from './network';
import { OfflineDb } from './offline-db.service';
import { SyncStatus } from './sync-status.service';
import { PracticeMode } from '../../features/tutorial/practice-mode.service';

/** Un cambio guardado en el dispositivo, listo para reenviarse tal cual al servidor */
export interface QueuedRequest {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body?: unknown;
}

/**
 * Cola de cambios sin conexión de un módulo (mismas reglas que las listas):
 * - Sin red, el cambio se aplica en la copia local y se guarda en IndexedDB.
 * - Al volver la conexión (y cada 15 s) se envía en orden; un error de red detiene el envío.
 * - Lo que el servidor rechaza se descarta y se avisa (SyncStatus.rejected).
 * - Los ids los genera el dispositivo, así un reenvío no duplica.
 * - En modo práctica (tutoriales) no se guarda ni se envía nada: todo va directo a la
 *   práctica en memoria y la cola real queda en pausa hasta salir.
 * Se crea dentro del constructor de un servicio (contexto de inyección).
 */
export class OfflineQueue<M extends QueuedRequest = QueuedRequest> {
  private readonly http = inject(HttpClient);
  private readonly db = inject(OfflineDb);
  private readonly status = inject(SyncStatus);
  private readonly practice = inject(PracticeMode);

  /** Sube cada vez que la cola termina de enviarse: las pantallas recargan desde el servidor */
  readonly synced = signal(0);

  private queue: M[] = [];
  private readonly ready: Promise<void>;
  /** Los cambios se procesan de a uno, en el orden en que la persona los hizo */
  private chain: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly source: string,
  ) {
    this.ready = this.db.get<M[]>(storageKey).then((saved) => {
      this.queue = saved ?? [];
      this.status.setQueued(source, this.queue.length);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush());
      setInterval(() => void this.flush(), 15_000);
    }
    void this.ready.then(() => this.flush());
    // Al cerrar sesión se descarta la cola en memoria (la del dispositivo ya se borró)
    const auth = inject(AuthService);
    effect(() => {
      if (auth.user() === null) {
        this.queue = [];
        this.status.setQueued(source, 0);
      }
    });
  }

  /** Hay cambios sin enviar que cumplen la condición */
  has(match: (m: M) => boolean = () => true): boolean {
    if (this.practice.active()) return false;
    return this.queue.some(match);
  }

  private send<T>(m: M): Promise<T> {
    return firstValueFrom(this.http.request<T>(m.method, m.url, { body: m.body }));
  }

  private async persist(): Promise<void> {
    this.status.setQueued(this.source, this.queue.length);
    await this.db.set(this.storageKey, this.queue);
  }

  /** Envía la cola en orden. Se detiene en el primer error que vale la pena reintentar. */
  flush(): Promise<void> {
    if (this.practice.active()) return Promise.resolve();
    this.flushing ??= (async () => {
      await this.ready;
      let sent = false;
      while (this.queue.length) {
        try {
          await this.send(this.queue[0]!);
          sent = true;
        } catch (err) {
          if (isRetryable(err)) {
            if (isNetworkError(err)) this.status.online.set(false);
            return;
          }
          this.status.rejected.update((n) => n + 1);
        }
        this.status.online.set(true);
        this.queue.shift();
        await this.persist();
      }
      if (sent) this.synced.update((n) => n + 1);
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /**
   * Cambio con respaldo sin conexión: si ya hay cola o no hay red, se aplica en la copia local
   * (offline) y se guarda para después; si no, va directo al servidor (online).
   */
  mutate<T>(m: M, offline: () => Promise<T>, online: (res: unknown) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.ready;
      if (this.practice.active()) return online(await this.send(m));
      if (!this.queue.length) {
        try {
          const res = await this.send(m);
          this.status.online.set(true);
          return await online(res);
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          this.status.online.set(false);
        }
      }
      const result = await offline();
      this.queue.push(m);
      await this.persist();
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Lectura con respaldo: la red primero (se guarda copia); sin conexión, la última copia. */
  async read<T>(key: string, request: () => Promise<T>): Promise<T> {
    if (this.practice.active()) return request();
    try {
      const value = await request();
      this.status.online.set(true);
      await this.db.set(key, value);
      return value;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      this.status.online.set(false);
      const cached = await this.db.get<T>(key);
      if (cached === undefined) throw err;
      return cached;
    }
  }

  cached<T>(key: string): Promise<T | undefined> {
    if (this.practice.active()) return Promise.resolve(undefined);
    return this.db.get<T>(key);
  }

  save(key: string, value: unknown): Promise<void> {
    if (this.practice.active()) return Promise.resolve();
    return this.db.set(key, value);
  }
}
