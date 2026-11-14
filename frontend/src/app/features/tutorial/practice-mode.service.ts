import { HttpRequest } from '@angular/common/http';

/** Respuesta inventada por la práctica de un módulo (status >= 400 = error con body { error }) */
export interface PracticeResponse {
  status: number;
  body: unknown;
}

/**
 * Práctica sobre las pantallas reales de un módulo (Finanzas): responde en memoria las llamadas
 * a la API del módulo, también las lecturas, así la pantalla muestra solo los datos de práctica.
 */
export interface PracticeHandler {
  /** null: esta llamada no es de la práctica */
  handle(req: HttpRequest<unknown>): PracticeResponse | null;
  /** Rutas de la API del módulo: durante la práctica nunca llegan al servidor */
  owns(url: string): boolean;
}
import { Injectable, inject, signal } from '@angular/core';
import { AuthService, User } from '../../core/auth/auth.service';

/**
 * Modo práctica de los tutoriales: lo que se hace en la copia de una pantalla vive solo en memoria.
 * Al salir, la cuenta vuelve a como estaba (tema, idioma, foto…), sin haber tocado el servidor.
 */
@Injectable({ providedIn: 'root' })
export class PracticeMode {
  private readonly auth = inject(AuthService);
  readonly active = signal(false);
  /** La cuenta real al entrar a la práctica */
  private snapshot: User | null = null;
  /** Práctica de un módulo sobre sus pantallas reales (Finanzas) */
  private moduleHandler: PracticeHandler | null = null;
  /**
   * Sube al entrar y salir de la práctica y cuando cambian sus datos por fuera de una llamada:
   * las pantallas reales que la usan vuelven a cargar.
   */
  readonly revision = signal(0);

  get handler(): PracticeHandler | null {
    return this.active() ? this.moduleHandler : null;
  }

  /** Usa la práctica en memoria de un módulo hasta que termine la práctica */
  use(handler: PracticeHandler): void {
    this.moduleHandler = handler;
    this.revision.update((n) => n + 1);
  }

  /** Los datos de práctica cambiaron (ej. el tutorial agregó una tarjeta) */
  refresh(): void {
    this.revision.update((n) => n + 1);
  }

  start(): void {
    if (this.active()) return;
    this.snapshot = this.auth.user() ?? null;
    this.active.set(true);
    // Las ventanas de las pantallas reales se abren sin el modo modal (shared/modal.ts)
    document.body.classList.add('oh-practice');
  }

  /** Devuelve la cuenta real (con el estado de los tutoriales, que sí se guarda) */
  end(): void {
    if (!this.active()) return;
    this.active.set(false);
    document.body.classList.remove('oh-practice');
    if (this.moduleHandler) {
      this.moduleHandler = null;
      this.revision.update((n) => n + 1);
    }
    const real = this.snapshot;
    this.snapshot = null;
    if (real)
      this.auth.setUser({ ...real, tutorials: this.auth.user()?.tutorials ?? real.tutorials });
  }

  /**
   * Lo que el servidor respondería a un cambio de la cuenta (perfil, tema, foto, avisos),
   * aplicado solo en memoria. null = no es un cambio de la cuenta: no se permite en la práctica.
   */
  fakeUserChange(req: HttpRequest<unknown>): User | null {
    const user = this.auth.user();
    if (!user) return null;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const route = `${req.method} ${req.url.split('?')[0]}`;
    switch (route) {
      case 'PATCH /api/me':
        return { ...user, ...(body as Partial<User>) };
      case 'PATCH /api/me/settings': {
        const {
          reminderHour,
          reminderStartDays,
          reminderEveryDays,
          calendarPromptDismissed,
          ...notifications
        } = body;
        return {
          ...user,
          notifications: {
            ...user.notifications,
            ...(notifications as Partial<User['notifications']>),
          },
          reminders: {
            hour: (reminderHour as number | undefined) ?? user.reminders.hour,
            startDays: (reminderStartDays as number | undefined) ?? user.reminders.startDays,
            everyDays: (reminderEveryDays as number | undefined) ?? user.reminders.everyDays,
          },
          calendarPromptDismissed:
            (calendarPromptDismissed as boolean | undefined) ?? user.calendarPromptDismissed,
        };
      }
      case 'PUT /api/me/theme':
        return { ...user, theme: (body['theme'] as User['theme']) ?? null };
      case 'PUT /api/me/avatar-preset':
        return {
          ...user,
          avatarPreset: (body['preset'] as string | null) ?? null,
          avatarUrl: null,
        };
      case 'PUT /api/me/avatar':
        return req.body instanceof Blob
          ? { ...user, avatarUrl: URL.createObjectURL(req.body), avatarPreset: null }
          : null;
      case 'DELETE /api/me/avatar':
        return { ...user, avatarUrl: null };
      default:
        return null;
    }
  }
}
