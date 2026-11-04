import { Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { I18n } from '../i18n/i18n.service';
import { ToastService } from '../../shared/toast.service';

/**
 * Cuando el service worker termina de bajar una versión nueva de la app, avisa con "Actualizar".
 * Sin esto la versión nueva recién se usa al cerrar y volver a abrir la app.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  // Opcional: en pruebas no hay service worker
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);

  start(): void {
    const sw = this.sw;
    if (!sw?.isEnabled) return;
    sw.versionUpdates.pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY')).subscribe(() => {
      this.toast.show(this.i18n.t('update.ready'), {
        actionLabel: this.i18n.t('update.reload'),
        durationMs: 60_000,
        action: () => void sw.activateUpdate().then(() => document.location.reload()),
      });
    });
  }
}
