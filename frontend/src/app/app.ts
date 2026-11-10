import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent } from './shared/confirm-dialog.component';
import { ToastComponent } from './shared/toast.component';
import { AppUpdateService } from './core/offline/app-update.service';
import { ThemeService } from './core/theme/theme.service';
import { OverdueBadgeService } from './features/tasks/overdue-badge.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmDialogComponent, ToastComponent],
  template: '<router-outlet /><oh-confirm-dialog /><oh-toast />',
})
export class App {
  // Aplica la paleta del usuario desde el arranque
  private readonly theme = inject(ThemeService);

  constructor() {
    inject(AppUpdateService).start();
    // Tareas vencidas en el título de la pestaña y en el ícono de la app instalada
    inject(OverdueBadgeService).start();
  }
}
