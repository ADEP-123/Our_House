import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'oh-toast',
  template: `
    <div class="region" aria-live="polite">
      @if (toasts.current(); as toast) {
        <div class="toast">
          <span>{{ toast.message }}</span>
          @if (toast.actionLabel) {
            <button type="button" (click)="toasts.runAction()">{{ toast.actionLabel }}</button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .region {
      position: fixed;
      left: 50%;
      bottom: calc(88px + env(safe-area-inset-bottom));
      transform: translateX(-50%);
      z-index: 10;
      width: min(92vw, 480px);
    }
    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 12px 12px 18px;
      border-radius: var(--oh-radius);
      background: var(--oh-text);
      color: var(--oh-background);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
      font-size: 0.9375rem;
    }
    button {
      flex: none;
      min-height: 36px;
      padding: 0 12px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: color-mix(in srgb, var(--oh-primary) 50%, var(--oh-background));
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    @media (min-width: 840px) {
      .region {
        bottom: 24px;
      }
    }
  `,
})
export class ToastComponent {
  protected readonly toasts = inject(ToastService);
}
