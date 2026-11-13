import { HttpRequest } from '@angular/common/http';
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

  start(): void {
    if (this.active()) return;
    this.snapshot = this.auth.user() ?? null;
    this.active.set(true);
  }

  /** Devuelve la cuenta real (con el estado de los tutoriales, que sí se guarda) */
  end(): void {
    if (!this.active()) return;
    this.active.set(false);
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
