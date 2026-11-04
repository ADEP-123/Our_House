import { Injectable } from '@angular/core';
import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval';

/**
 * Almacenamiento en el dispositivo (IndexedDB) para usar la app sin conexión.
 * Si IndexedDB no está disponible (pruebas, navegación privada antigua) usa memoria.
 */
@Injectable({ providedIn: 'root' })
export class OfflineDb {
  private readonly store: UseStore | null = (() => {
    try {
      return typeof indexedDB === 'undefined' ? null : createStore('our-house', 'cache');
    } catch {
      return null;
    }
  })();
  private readonly memory = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.store) return this.memory.get(key) as T | undefined;
    return get<T>(key, this.store).catch(() => undefined);
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.store) {
      this.memory.set(key, structuredClone(value));
      return;
    }
    await set(key, value, this.store).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    if (!this.store) this.memory.delete(key);
    else await del(key, this.store).catch(() => undefined);
  }

  /** Al cerrar sesión: no deja datos de la cuenta en el dispositivo */
  async clear(): Promise<void> {
    this.memory.clear();
    if (this.store) await clear(this.store).catch(() => undefined);
  }
}
