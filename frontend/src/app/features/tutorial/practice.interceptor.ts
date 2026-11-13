import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { of, throwError } from 'rxjs';
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
