import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { formatMoney } from '../lists/item-logic';
import { localToday } from './finance-logic';
import { Account } from './finance.models';
import { FinanceStore } from './finance.store';
import { amountForInput, parseAmount } from './movement-logic';

/** Ajustar saldo: se escribe el saldo real y se crea un movimiento por la diferencia. */
@Component({
  selector: 'oh-adjust-dialog',
  imports: [TPipe],
  template: `
    <dialog #dialog aria-labelledby="adjust-title">
      <form (submit)="$event.preventDefault(); save()" novalidate>
        <h2 id="adjust-title">{{ 'finance.movements.adjustTitle' | t }}</h2>
        <p class="oh-hint">
          {{ 'finance.movements.adjustHint' | t: { balance: money(account().balance) } }}
        </p>
        <div class="oh-field">
          <label for="adjust-real">{{ 'finance.movements.adjustReal' | t }}</label>
          <input
            #realInput
            id="adjust-real"
            class="oh-input big"
            inputmode="decimal"
            autocomplete="off"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
          />
        </div>
        <div class="oh-field">
          <label for="adjust-date">{{ 'finance.movements.date' | t }}</label>
          <input
            id="adjust-date"
            class="oh-input"
            type="date"
            [value]="date()"
            (input)="date.set($any($event.target).value)"
          />
        </div>
        @if (diff(); as d) {
          <p class="diff" [class.negative]="d < 0">
            {{ 'finance.movements.adjustDiff' | t: { amount: (d > 0 ? '+' : '') + money(d) } }}
          </p>
        }
        @if (error(); as e) {
          <p class="oh-alert is-error" role="alert">{{ e }}</p>
        }
        <div class="actions">
          <button type="button" class="oh-btn oh-btn--text" (click)="close()">
            {{ 'finance.cancel' | t }}
          </button>
          <button type="submit" class="oh-btn oh-btn--filled" [disabled]="busy() || !diff()">
            {{ 'finance.movements.adjustSave' | t }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(92vw, 420px);
      padding: 22px;
      border: 0;
      border-radius: var(--oh-radius-lg);
      background: var(--oh-surface);
      color: var(--oh-text);
      box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.4);
    }
    form {
      display: grid;
      gap: 12px;
    }
    h2 {
      margin: 0;
      font-size: 1.125rem;
    }
    .big {
      font-size: 1.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .diff {
      margin: 0;
      font-weight: 600;
    }
    .negative {
      color: var(--oh-error);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class AdjustDialogComponent {
  readonly account = input.required<Account>();
  readonly saved = output<void>();

  private readonly store = inject(FinanceStore);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('realInput');

  protected readonly text = signal('');
  protected readonly date = signal(localToday());
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly diff = computed(() => {
    const real = parseAmount(this.text(), this.i18n.locale());
    return real === null ? null : Math.round((real - this.account().balance) * 100) / 100;
  });

  open(): void {
    this.text.set(amountForInput(this.account().balance, this.i18n.locale()));
    this.date.set(localToday());
    this.error.set(null);
    this.dialog().nativeElement.showModal();
    // El saldo actual queda seleccionado: lo que se escriba lo reemplaza
    setTimeout(() => this.input()?.nativeElement.select());
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected money(n: number): string {
    return formatMoney(n, this.account().currency, this.i18n.locale());
  }

  async save(): Promise<void> {
    const real = parseAmount(this.text(), this.i18n.locale());
    if (real === null || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.adjust(this.account(), {
        id: crypto.randomUUID(),
        balance: real,
        date: this.date(),
        description: this.i18n.t('finance.movements.adjustDescription'),
      });
      this.close();
      this.saved.emit();
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
