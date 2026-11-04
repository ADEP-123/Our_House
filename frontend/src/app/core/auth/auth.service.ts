import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18n, Locale } from '../i18n/i18n.service';

export interface User {
  id: string;
  email: string;
  nickname: string;
  locale: Locale;
  timezone: string;
}

const browserTimezone = (): string => {
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

  /** undefined = aún no se sabe; null = sin sesión */
  private readonly current = signal<User | null | undefined>(undefined);
  readonly user = this.current.asReadonly();

  /** Aplica el usuario recibido y su idioma preferido. */
  setUser(user: User | null): void {
    this.current.set(user);
    if (user) this.i18n.setLocale(user.locale);
  }

  /** Consulta la sesión una vez; las siguientes llamadas usan lo que ya se sabe. */
  async ensureLoaded(): Promise<User | null> {
    if (this.current() !== undefined) return this.current()!;
    try {
      const { user } = await firstValueFrom(this.http.get<{ user: User }>('/api/auth/me'));
      this.setUser(user);
    } catch {
      this.current.set(null);
    }
    return this.current()!;
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
    this.current.set(null);
    void this.router.navigate(['/ingresar'], { queryParams: returnUrl ? { volver: returnUrl } : {} });
  }
}
