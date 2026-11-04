import { HttpErrorResponse } from '@angular/common/http';

/**
 * Sin respuesta del servidor: sin señal, servidor dormido o caído. Vale la pena reintentar.
 * Sin conexión el navegador responde con status 0; si la app está instalada (service worker),
 * el service worker responde 504 en su lugar.
 */
export const isNetworkError = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && (err.status === 0 || err.status === 504);

/** Errores que se arreglan solos reintentando más tarde (sin conexión, servidor caído, sesión renovándose) */
export const isRetryable = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && (err.status === 0 || err.status === 401 || err.status >= 500);
