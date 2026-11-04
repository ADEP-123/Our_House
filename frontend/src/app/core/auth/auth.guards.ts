import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Pantallas de la app: sin sesión se va al inicio de sesión y luego se vuelve aquí. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const user = await inject(AuthService).ensureLoaded();
  return user ? true : router.createUrlTree(['/ingresar'], { queryParams: { volver: state.url } });
};

/** Pantallas de acceso (ingresar, registro…): con sesión iniciada no tiene sentido verlas. */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const user = await inject(AuthService).ensureLoaded();
  return user ? router.createUrlTree(['/inicio']) : true;
};
