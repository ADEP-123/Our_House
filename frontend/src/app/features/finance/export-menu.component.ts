import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ToastService } from '../../shared/toast.service';
import { FinanceIoService } from './finance-io.service';
import { Summary } from './finance.models';

/**
 * Botón "Exportar" con Excel o CSV: de una cuenta (en su hoja) o de lo que muestra el resumen.
 * Con el resumen, el Excel lleva además la hoja con la tabla categoría × período.
 */
@Component({
  selector: 'oh-export-menu',
  imports: [TPipe],
  template: `
    <details class="menu-wrap" #details>
      <summary class="oh-btn oh-btn--text" [attr.aria-busy]="busy()">
        {{ (busy() ? 'finance.io.exporting' : 'finance.io.export') | t }}
      </summary>
      <div class="menu" role="group" [attr.aria-label]="'finance.io.export' | t">
        <button type="button" [disabled]="busy()" (click)="run('xlsx')">
          <strong>Excel</strong>
          <small>{{
            (summary() ? 'finance.io.xlsxSummaryHint' : 'finance.io.xlsxHint') | t
          }}</small>
        </button>
        <button type="button" [disabled]="busy()" (click)="run('csv')">
          <strong>CSV</strong>
          <small>{{ 'finance.io.csvHint' | t }}</small>
        </button>
      </div>
    </details>
  `,
  styles: `
    .menu-wrap {
      position: relative;
    }
    summary {
      list-style: none;
      cursor: pointer;
      &::-webkit-details-marker {
        display: none;
      }
    }
    .menu {
      position: absolute;
      z-index: 4;
      right: 0;
      top: calc(100% + 4px);
      display: grid;
      gap: 2px;
      min-width: 240px;
      padding: 6px;
      background: var(--oh-surface);
      border: 1px solid var(--oh-border-strong);
      border-radius: var(--oh-radius);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
    }
    button {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border: 0;
      border-radius: calc(var(--oh-radius) - 2px);
      background: transparent;
      color: var(--oh-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      &:hover,
      &:focus-visible {
        background: var(--oh-secondary-soft);
      }
      &:disabled {
        opacity: 0.6;
        cursor: progress;
      }
    }
    small {
      color: var(--oh-text-muted);
    }
  `,
})
export class ExportMenuComponent {
  readonly familyId = input.required<string>();
  /** Cuentas a exportar (vacío: las activas que la persona ve) */
  readonly accounts = input<string[]>([]);
  readonly from = input<string | undefined>();
  readonly to = input<string | undefined>();
  /** Va en el nombre del archivo: la cuenta o "Resumen" */
  readonly subject = input.required<string>();
  readonly summary = input<Summary | undefined>();

  private readonly io = inject(FinanceIoService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly details = viewChild.required<ElementRef<HTMLDetailsElement>>('details');
  protected readonly busy = signal(false);

  protected async run(format: 'xlsx' | 'csv'): Promise<void> {
    this.busy.set(true);
    try {
      await this.io.download(
        this.familyId(),
        { accounts: this.accounts(), from: this.from(), to: this.to() },
        format,
        this.subject(),
        { summary: format === 'xlsx' ? this.summary() : undefined },
      );
      this.details().nativeElement.open = false;
    } catch (err) {
      this.toast.show(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
