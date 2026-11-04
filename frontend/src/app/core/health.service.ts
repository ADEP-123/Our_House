import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

export type ApiState = 'up' | 'degraded' | 'offline';

interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  /** 'up' = API y base de datos bien, 'degraded' = API sin base de datos, 'offline' = API inaccesible. */
  check(): Observable<ApiState> {
    return this.http.get<HealthResponse>('/api/health').pipe(
      map((): ApiState => 'up'),
      // El backend responde 503 con cuerpo cuando la base de datos está caída
      catchError((err) => of<ApiState>(err?.error?.db === 'down' ? 'degraded' : 'offline')),
    );
  }
}
