import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService, User, UserNotifications } from '../../core/auth/auth.service';
import { Locale } from '../../core/i18n/i18n.service';

export interface ProfileChanges {
  firstName?: string;
  lastName?: string;
  nickname?: string;
  locale?: Locale;
  timezone?: string;
}

/** Llamadas de /api/me. Cada respuesta con usuario actualiza la sesión (y el idioma). */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private async apply(request: Promise<{ user: User }>): Promise<User> {
    const { user } = await request;
    this.auth.setUser(user);
    return user;
  }

  update(changes: ProfileChanges) {
    return this.apply(firstValueFrom(this.http.patch<{ user: User }>('/api/me', changes)));
  }

  /** Preferencias de notificaciones: se guardan al cambiar cada interruptor */
  setSettings(changes: Partial<UserNotifications> & { reminderHour?: number; reminderStartDays?: number; reminderEveryDays?: number }) {
    return this.apply(firstValueFrom(this.http.patch<{ user: User }>('/api/me/settings', changes)));
  }

  uploadAvatar(file: File) {
    return this.apply(
      firstValueFrom(this.http.put<{ user: User }>('/api/me/avatar', file, { headers: { 'Content-Type': file.type } })),
    );
  }

  setAvatarPreset(preset: string | null) {
    return this.apply(firstValueFrom(this.http.put<{ user: User }>('/api/me/avatar-preset', { preset })));
  }

  changePassword(currentPassword: string, newPassword: string) {
    return firstValueFrom(this.http.put<void>('/api/me/password', { currentPassword, newPassword }));
  }

  requestEmailChange(newEmail: string, password: string) {
    return firstValueFrom(this.http.post<{ pendingEmail: string }>('/api/me/email', { newEmail, password }));
  }

  confirmEmailChange(token: string) {
    return firstValueFrom(this.http.post<void>('/api/auth/confirm-email-change', { token }));
  }

  deleteAccount(password: string) {
    return firstValueFrom(this.http.delete<void>('/api/me', { body: { password } }));
  }
}
