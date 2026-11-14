import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, of, throwError, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { PracticeMode } from './practice-mode.service';

/** Lo que sí llega al servidor durante la práctica: leer, la sesión y el avance de los tutoriales */
const ALLOWED = ['/api/auth/', '/api/me/tutorials/'];

/**
 * Red de seguridad del modo práctica: ningún cambio llega a la base de datos.
 * Los cambios de la cuenta (tema, perfil, foto, avisos) se responden en memoria para que la
 * pantalla se comporte igual; cualquier otro cambio se rechaza con PRACTICE_MODE.
 */
export const practiceInterceptor: HttpInterceptorFn = (req, next) => {
  const practice = inject(PracticeMode);
  // Práctica sobre las pantallas reales de un módulo: sus llamadas (también las lecturas) se
  // responden en memoria, con una pequeña espera como la red, y nunca llegan al servidor
  const handler = practice.handler;
  if (handler && req.url.startsWith('/api/')) {
    const answer = handler.handle(req);
    if (answer) return respond(answer.status, answer.body, req.url);
    if (handler.owns(req.url.split('?')[0]!))
      return respond(403, { error: 'PRACTICE_MODE' }, req.url);
  }
  if (
    !practice.active() ||
    req.method === 'GET' ||
    !req.url.startsWith('/api/') ||
    ALLOWED.some((path) => req.url.startsWith(path))
  ) {
    return next(req);
  }
  const user = practice.fakeUserChange(req);
  if (user) return of(new HttpResponse({ status: 200, url: req.url, body: { user } }));
  return throwError(
    () => new HttpErrorResponse({ status: 403, url: req.url, error: { error: 'PRACTICE_MODE' } }),
  );
};

function respond(status: number, body: unknown, url: string): Observable<HttpResponse<unknown>> {
  return timer(120).pipe(
    mergeMap(() =>
      status < 400
        ? of(new HttpResponse({ status, body, url }))
        : throwError(() => new HttpErrorResponse({ status, error: body, url })),
    ),
  );
}
