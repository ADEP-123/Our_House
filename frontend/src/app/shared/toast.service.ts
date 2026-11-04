import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

/** Avisos breves abajo de la pantalla, con una acción opcional (ej. Deshacer). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly current = signal<Toast | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;

  show(message: string, options: { actionLabel?: string; action?: () => void; durationMs?: number } = {}): void {
    clearTimeout(this.timer);
    const toast = { id: this.nextId++, message, actionLabel: options.actionLabel, action: options.action };
    this.current.set(toast);
    this.timer = setTimeout(() => this.dismiss(toast.id), options.durationMs ?? 5000);
  }

  runAction(): void {
    const toast = this.current();
    this.dismiss(toast?.id);
    toast?.action?.();
  }

  dismiss(id?: number): void {
    if (id === undefined || this.current()?.id === id) this.current.set(null);
  }
}
