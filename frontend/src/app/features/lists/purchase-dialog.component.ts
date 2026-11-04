import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { formatAmount, formatMoney, remaining } from './item-logic';
import { ListItem } from './lists.models';

export interface PurchaseInput {
  amount: number | null;
  spent: number | null;
}

/**
 * "¿Cuánto compraste?": la cantidad viene con lo que falta, se suma a lo ya comprado
 * y antes de confirmar muestra el total y si queda completo o parcial.
 */
@Component({
  selector: 'oh-purchase-dialog',
  imports: [TPipe],
  template: `
    <dialog #dialog (close)="closed.emit()" aria-labelledby="purchase-title">
      <form (submit)="$event.preventDefault(); save()" novalidate>
        <h2 id="purchase-title">{{ item().text }}</h2>
        @if (item().purchased !== null && item().amount !== null) {
          <p class="oh-muted already">{{ 'lists.purchase.already' | t: { done: fmt(item().purchased!), of: amountLabel(item().amount!) } }}</p>
        }

        @if (item().amount !== null) {
          <div class="oh-field">
            <label for="purchase-amount">{{ 'lists.purchase.howMuch' | t }}</label>
            <div class="with-unit">
              <input
                id="purchase-amount"
                class="oh-input"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                [value]="amountText()"
                (input)="amountText.set($any($event.target).value)"
              />
              @if (item().unit) {
                <span class="unit">{{ item().unit }}</span>
              }
            </div>
          </div>
        }

        <div class="oh-field">
          <label for="purchase-spent">{{ 'lists.purchase.spent' | t: { currency: currency() } }}</label>
          <input
            id="purchase-spent"
            class="oh-input"
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            [placeholder]="'lists.purchase.optional' | t"
            [value]="spentText()"
            (input)="spentText.set($any($event.target).value)"
          />
        </div>

        @if (invalid()) {
          <p class="oh-alert is-error" role="alert">{{ 'lists.purchase.invalid' | t }}</p>
        } @else if (summary(); as s) {
          <p class="summary" [class.partial]="!s.complete" role="status">
            {{ (s.complete ? 'lists.purchase.totalComplete' : 'lists.purchase.totalPartial') | t: { done: s.done, of: s.of } }}
            @if (s.spent) {
              <br />{{ 'lists.purchase.totalSpent' | t: { spent: s.spent } }}
            }
          </p>
        }

        <div class="actions">
          @if (item().purchased !== null) {
            <button type="button" class="oh-btn oh-btn--text danger" (click)="clear()">{{ 'lists.purchase.clear' | t }}</button>
          }
          <span class="spacer"></span>
          <button type="button" class="oh-btn oh-btn--text" (click)="close()">{{ 'lists.items.cancel' | t }}</button>
          <button type="submit" class="oh-btn oh-btn--filled" [disabled]="invalid()">{{ 'lists.purchase.confirm' | t }}</button>
        </div>
      </form>
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
    form {
      display: grid;
      gap: 16px;
    }
    h2 {
      font-size: 1.125rem;
      overflow-wrap: anywhere;
    }
    .already {
      margin-top: -8px;
    }
    .with-unit {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .unit {
      color: var(--oh-text-muted);
      white-space: nowrap;
    }
    .summary {
      padding: 10px 14px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--oh-success) 12%, var(--oh-surface));
      line-height: 1.5;
    }
    .summary.partial {
      background: color-mix(in srgb, var(--oh-primary) 10%, var(--oh-surface));
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .spacer {
      flex: 1;
    }
    .danger {
      color: var(--oh-error);
    }
  `,
})
export class PurchaseDialogComponent {
  readonly item = input.required<ListItem>();
  readonly currency = input.required<string>();
  readonly confirmed = output<PurchaseInput>();
  /** Quitar lo comprado: el ítem vuelve a pendiente */
  readonly cleared = output<void>();
  readonly closed = output<void>();

  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly amountText = signal('');
  protected readonly spentText = signal('');

  private readonly amount = computed(() => (this.item().amount === null ? null : parse(this.amountText())));
  private readonly spent = computed(() => (this.spentText().trim() === '' ? null : parse(this.spentText())));

  protected readonly invalid = computed(() => {
    const amount = this.amount();
    const spent = this.spent();
    if (this.item().amount !== null && (amount === undefined || amount === null || amount <= 0)) return true;
    return spent === undefined || (spent !== null && spent < 0);
  });

  /** Lo que quedará registrado al confirmar */
  protected readonly summary = computed(() => {
    const item = this.item();
    const spent = this.spent();
    const totalSpent = spent ? (item.spent ?? 0) + spent : item.spent;
    const spentLabel = totalSpent ? formatMoney(totalSpent, this.currency(), this.i18n.locale()) : null;
    if (item.amount === null) return { complete: true, done: '', of: '', spent: spentLabel };
    const done = (item.purchased ?? 0) + (this.amount() ?? 0);
    return { complete: done >= item.amount, done: this.fmt(done), of: this.amountLabel(item.amount), spent: spentLabel };
  });

  constructor() {
    effect(() => {
      const left = remaining(this.item());
      this.amountText.set(left ? String(left) : '');
      this.spentText.set('');
      const el = this.dialog().nativeElement;
      if (!el.open) el.showModal();
    });
  }

  protected fmt(n: number): string {
    return formatAmount(n, this.i18n.locale());
  }

  protected amountLabel(n: number): string {
    return [this.fmt(n), this.item().unit].filter(Boolean).join(' ');
  }

  protected save(): void {
    if (this.invalid()) return;
    this.confirmed.emit({ amount: this.amount() ?? null, spent: this.spent() ?? null });
    this.dialog().nativeElement.close();
  }

  protected clear(): void {
    this.cleared.emit();
    this.dialog().nativeElement.close();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }
}

/** Número escrito por la persona (acepta coma decimal). undefined = no es un número. */
function parse(text: string): number | undefined {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || Number.isNaN(value) ? undefined : value;
}
