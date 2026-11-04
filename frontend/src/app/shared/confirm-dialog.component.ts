import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ConfirmService } from './confirm.service';

/** Diálogo nativo (<dialog>): atrapa el foco y se cierra con Escape. Se monta una sola vez en la app. */
@Component({
  selector: 'oh-confirm-dialog',
  template: `
    <dialog #dialog (close)="confirm.close(false)" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      @if (confirm.current(); as req) {
        <h2 id="confirm-title">{{ req.title }}</h2>
        <p id="confirm-message">{{ req.message }}</p>
        <div class="actions">
          <button type="button" class="oh-btn oh-btn--text" (click)="confirm.close(false)">{{ req.cancelLabel }}</button>
          <button
            type="button"
            class="oh-btn"
            [class.oh-btn--danger]="req.danger"
            [class.oh-btn--filled]="!req.danger"
            (click)="confirm.close(true)"
          >
            {{ req.confirmLabel }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(92vw, 420px);
      padding: 24px;
      border: 0;
      border-radius: var(--oh-radius-lg);
      background: var(--oh-surface);
      color: var(--oh-text);
      box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.4);
    }
    h2 {
      font-size: 1.125rem;
      margin-bottom: 10px;
    }
    p {
      color: var(--oh-text-muted);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 24px;
    }
  `,
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.confirm.current() && !el.open) el.showModal();
      if (!this.confirm.current() && el.open) el.close();
    });
  }
}
