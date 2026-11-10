import { Injectable, computed, signal } from '@angular/core';

/** Estado de conexión y de cambios pendientes, para el aviso de la barra superior. */
@Injectable({ providedIn: 'root' })
export class SyncStatus {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** Pendientes de cada módulo con cola propia (listas, finanzas…) */
  private readonly counts = signal<Record<string, number>>({});
  /** Cambios guardados en el dispositivo que aún no llegan al servidor (todos los módulos) */
  readonly queued = computed(() => Object.values(this.counts()).reduce((sum, n) => sum + n, 0));
  /** Cambios que el servidor rechazó al sincronizar (ej. la lista se archivó mientras tanto) */
  readonly rejected = signal(0);

  setQueued(source: string, n: number): void {
    this.counts.update((c) => ({ ...c, [source]: n }));
  }

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }
}
