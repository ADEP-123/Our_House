import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { AuthLayoutComponent } from './features/auth/auth-layout.component';

// Rutas en español: son las que aparecen en los enlaces de los correos
export const routes: Routes = [
  {
    path: '',
    component: AuthLayoutComponent,
    children: [
      {
        path: '',
        canActivateChild: [guestGuard],
        children: [
          { path: 'ingresar', loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
          { path: 'registro', loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage) },
          {
            path: 'revisa-tu-correo',
            loadComponent: () => import('./features/auth/check-email.page').then((m) => m.CheckEmailPage),
          },
          {
            path: 'recuperar-contrasena',
            loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
          },
        ],
      },
      // Enlaces de los correos: funcionan con o sin sesión iniciada
      {
        path: 'verificar-correo',
        loadComponent: () => import('./features/auth/verify-email.page').then((m) => m.VerifyEmailPage),
      },
      {
        path: 'confirmar-correo',
        loadComponent: () => import('./features/auth/confirm-email.page').then((m) => m.ConfirmEmailPage),
      },
      {
        path: 'restablecer-contrasena',
        loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
      },
    ],
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: 'inicio', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
      {
        path: 'apariencia',
        loadComponent: () => import('./features/appearance/appearance.page').then((m) => m.AppearancePage),
      },
      { path: 'perfil', loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage) },
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    ],
  },
  { path: '**', redirectTo: 'inicio' },
];
