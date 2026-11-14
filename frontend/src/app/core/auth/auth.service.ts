import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18n, Locale } from '../i18n/i18n.service';
import { OfflineDb } from '../offline/offline-db.service';
import { isNetworkError } from '../offline/network';
import type { Theme } from '../theme/themes';

export interface User {
  id: string;
  email: string;
  nickname: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  avatarPreset: string | null;
  theme: Theme | null;
  locale: Locale;
  timezone: string;
  notifications: UserNotifications;
  /** Recordatorios de tareas con fecha: valores por defecto */
  reminders: ReminderDefaults;
  /** Ya no mostrar el aviso de conectar Google Calendar */
  calendarPromptDismissed: boolean;
  /** Tutoriales vistos, saltados o a medias (una sesión guardada antes de la fase 8 no lo trae) */
  tutorials?: Partial<Record<'lists' | 'account' | 'calendar' | 'finance' | 'getting-started', { state: 'done' | 'skipped' | 'progress'; step?: number }>>;
}

export interface UserNotifications {
  newLists: boolean;
  assignments: boolean;
  reminders: boolean;
  secretViews: boolean;
  finance: boolean;
  scheduled: boolean;
}

export interface ReminderDefaults {
  hour: number;
  startDays: number;
  everyDays: number;
}

const USER_KEY = 'oh_user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly offlineDb = inject(OfflineDb);

  /** undefined = aún no se sabe; null = sin sesión */
  private readonly current = signal<User | null | undefined>(undefined);
  readonly user = this.current.asReadonly();

  /** Aplica el usuario recibido y su idioma preferido. */
  setUser(user: User | null): void {
    this.current.set(user);
    if (user) this.i18n.setLocale(user.locale);
    // Copia local para abrir la app sin conexión
    try {
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    } catch {
      // sin almacenamiento local: sin modo offline
    }
  }

  /** Consulta la sesión una vez; las siguientes llamadas usan lo que ya se sabe. */
  async ensureLoaded(): Promise<User | null> {
    if (this.current() !== undefined) return this.current()!;
    try {
      const { user } = await firstValueFrom(this.http.get<{ user: User }>('/api/auth/me'));
      this.setUser(user);
    } catch (err) {
      // Sin conexión: se usa la última sesión conocida; la API la vuelve a validar al reconectar
      const cached = isNetworkError(err) ? readCachedUser() : null;
      if (cached) this.current.set(cached);
      else this.setUser(null);
    }
    return this.current()!;
  }

  /** Vuelve a pedir los datos del usuario (ej. tras confirmar un cambio de correo). */
  async reload(): Promise<User | null> {
    this.current.set(undefined);
    return this.ensureLoaded();
  }

  isNicknameAvailable(nickname: string) {
    return this.http.get<{ available: boolean }>('/api/auth/nickname-available', { params: { nickname } });
  }

  register(data: { email: string; nickname: string; password: string }) {
    return firstValueFrom(
      this.http.post<{ email: string }>('/api/auth/register', {
        ...data,
        locale: this.i18n.locale(),
        timezone: browserTimezone(),
      }),
    );
  }

  async login(identifier: string, password: string): Promise<User> {
    const { user } = await firstValueFrom(this.http.post<{ user: User }>('/api/auth/login', { identifier, password }));
    this.setUser(user);
    return user;
  }

  async verifyEmail(token: string): Promise<User> {
    const { user } = await firstValueFrom(this.http.post<{ user: User }>('/api/auth/verify-email', { token }));
    this.setUser(user);
    return user;
  }

  resendVerification(email: string) {
    return firstValueFrom(this.http.post<void>('/api/auth/resend-verification', { email }));
  }

  forgotPassword(email: string) {
    return firstValueFrom(this.http.post<void>('/api/auth/forgot-password', { email }));
  }

  resetPassword(token: string, password: string) {
    return firstValueFrom(this.http.post<void>('/api/auth/reset-password', { token, password }));
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/auth/logout', {})).catch(() => undefined);
    this.endSession();
  }

  async logoutAll(): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/auth/logout-all', {}));
    this.endSession();
  }

  /** Limpia el estado local y lleva al inicio de sesión. */
  endSession(returnUrl?: string): void {
    this.setUser(null);
    try {
      localStorage.removeItem('oh_families');
    } catch {
      // nada que borrar
    }
    // No deja listas ni cambios pendientes de esta cuenta en el dispositivo
    void this.offlineDb.clear();
    void this.router.navigate(['/ingresar'], { queryParams: returnUrl ? { volver: returnUrl } : {} });
  }
}
