import { Injectable, signal } from '@angular/core';

/** Estado de conexión y de cambios pendientes, para el aviso de la barra superior. */
@Injectable({ providedIn: 'root' })
export class SyncStatus {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** Cambios guardados en el dispositivo que aún no llegan al servidor */
  readonly queued = signal(0);
  /** Cambios que el servidor rechazó al sincronizar (ej. la lista se archivó mientras tanto) */
  readonly rejected = signal(0);

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }
}
