import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, finalize, shareReplay, switchMap, throwError } from 'rxjs';

// Rutas donde un 401 es una respuesta normal y no debe intentar renovar la sesión
const SKIP = ['/api/auth/login', '/api/auth/refresh', '/api/auth/register', '/api/auth/logout'];

let refreshing$: Observable<void> | null = null;

/**
 * El JWT de acceso dura 15 minutos. Cuando una petición responde 401, renueva la sesión
 * con el refresh token (cookie) una sola vez, aunque fallen varias peticiones a la vez, y reintenta.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const http = inject(HttpClient);

  return next(req).pipe(
    catchError((err: unknown) => {
      const skip = !req.url.startsWith('/api/') || SKIP.some((path) => req.url.startsWith(path));
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || skip) return throwError(() => err);

      refreshing$ ??= http.post<void>('/api/auth/refresh', {}).pipe(
        finalize(() => (refreshing$ = null)),
        shareReplay(1),
      );
      // Si la renovación falla se propaga el 401 original y el guard lleva al inicio de sesión
      return refreshing$.pipe(
        switchMap(() => next(req)),
        catchError(() => throwError(() => err)),
      );
    }),
  );
};
