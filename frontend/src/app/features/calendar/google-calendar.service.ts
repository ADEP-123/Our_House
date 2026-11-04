import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface GoogleCalendarStatus {
  /** El servidor tiene configurada la conexión con Google */
  available: boolean;
  connected: boolean;
  email: string | null;
  calendarName: string;
}

/** Conexión con Google Calendar: las tareas con fecha aparecen en el calendario "Our House" de la persona. */
@Injectable({ providedIn: 'root' })
export class GoogleCalendarService {
  private readonly http = inject(HttpClient);
  readonly status = signal<GoogleCalendarStatus | null>(null);
  private loading: Promise<GoogleCalendarStatus | null> | null = null;

  /** Una vez por sesión; refresh: volver a consultar (ej. al volver de Google) */
  load(refresh = false): Promise<GoogleCalendarStatus | null> {
    if (refresh) this.loading = null;
    this.loading ??= firstValueFrom(this.http.get<GoogleCalendarStatus>('/api/google/status'))
      .then((s) => {
        this.status.set(s);
        return s;
      })
      .catch(() => {
        this.loading = null;
        return null;
      });
    return this.loading;
  }

  /** Lleva a la pantalla de permisos de Google; al terminar Google vuelve al perfil */
  async connect(): Promise<void> {
    const { url } = await firstValueFrom(this.http.post<{ url: string }>('/api/google/connect', {}));
    window.location.assign(url);
  }

  async disconnect(): Promise<void> {
    await firstValueFrom(this.http.delete<void>('/api/google'));
    this.status.update((s) => (s ? { ...s, connected: false, email: null } : s));
  }
}
