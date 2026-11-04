import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconComponent, IconName } from '../../shared/icon.component';

interface NavItem {
  path: string;
  label: TranslationKey;
  icon: IconName;
}

/**
 * Estructura de la app con sesión iniciada.
 * Móvil: barra superior + navegación inferior. Escritorio: riel lateral (Material navigation rail).
 */
@Component({
  selector: 'oh-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TPipe, IconComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);

  protected readonly nav: NavItem[] = [
    { path: '/inicio', label: 'shell.home', icon: 'home' },
    { path: '/perfil', label: 'shell.profile', icon: 'user' },
  ];

  logout(): void {
    void this.auth.logout();
  }
}
