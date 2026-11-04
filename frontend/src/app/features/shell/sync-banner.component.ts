import { Component, computed, effect, inject, untracked } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ToastService } from '../../shared/toast.service';

/** Aviso de conexión: sin red, o enviando los cambios hechos sin conexión. */
@Component({
  selector: 'oh-sync-banner',
  imports: [TPipe],
  template: `
    @if (state(); as s) {
      <p class="banner" [class.offline]="s === 'offline'" role="status">
        <span class="dot" aria-hidden="true"></span>
        @if (s === 'offline') {
          {{ (sync.queued() ? 'sync.offlinePending' : 'sync.offline') | t: { n: sync.queued() } }}
        } @else {
          {{ 'sync.sending' | t: { n: sync.queued() } }}
        }
      </p>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 16px;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 0.9rem;
      background: color-mix(in srgb, var(--oh-primary) 12%, var(--oh-surface));
      color: var(--oh-text);
    }
    .banner.offline {
      background: color-mix(in srgb, var(--oh-text) 8%, var(--oh-surface));
    }
    .dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--oh-primary);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .offline .dot {
      background: var(--oh-text);
      opacity: 0.5;
      animation: none;
    }
    @keyframes pulse {
      50% {
        opacity: 0.3;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .dot {
        animation: none;
      }
    }
  `,
})
export class SyncBannerComponent {
  protected readonly sync = inject(SyncStatus);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly state = computed(() => {
    if (!this.sync.online()) return 'offline';
    return this.sync.queued() > 0 ? 'sending' : null;
  });

  constructor() {
    // Un cambio que el servidor no aceptó al sincronizar (ej. la lista se archivó mientras tanto)
    let seen = 0;
    effect(() => {
      const rejected = this.sync.rejected();
      if (rejected > seen) untracked(() => this.toast.show(this.i18n.t('sync.rejected'), { durationMs: 8000 }));
      seen = rejected;
    });
  }
}
