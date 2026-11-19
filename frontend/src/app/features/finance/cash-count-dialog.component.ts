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
import { openModal } from '../../shared/modal';
import { ToastService } from '../../shared/toast.service';
import { formatMoney } from '../lists/item-logic';
import { AmountInputDirective } from './amount-input.directive';
import { cashRows, cashTotal, denominationLabel, pressKey } from './cash-logic';
import { localToday } from './finance-logic';
import { Account } from './finance.models';
import { FinanceStore } from './finance.store';
import { amountForInput, parseAmount } from './movement-logic';

/**
 * Contar efectivo: cuántos billetes y monedas de cada valor hay (o una calculadora normal) y,
 * si no cuadra con la app, ajustar el saldo al total. El conteo se guarda mientras la página
 * está abierta, por si se cierra para seguir contando después.
 */
@Component({
  selector: 'oh-cash-count-dialog',
  imports: [TPipe, AmountInputDirective],
  templateUrl: './cash-count-dialog.component.html',
  styleUrls: ['./cash-count-dialog.component.scss', './cash-calc.scss'],
})
export class CashCountDialogComponent {
  readonly account = input.required<Account>();
  /** Quien puede editar la cuenta puede ajustar el saldo; los demás solo cuentan */
  readonly canAdjust = input(false);
  readonly saved = output<void>();

  private readonly store = inject(FinanceStore);
  private readonly i18n = inject(I18n);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly tab = signal<'count' | 'calc'>('count');
  protected readonly counts = signal<Record<string, number>>({});
  protected readonly othersText = signal('');
  protected readonly expr = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly rows = computed(() => cashRows(this.account().currency));
  protected readonly groups = computed(() =>
    (['bill', 'coin'] as const)
      .map((kind) => ({ kind, rows: this.rows().filter((r) => r.kind === kind) }))
      .filter((g) => g.rows.length),
  );

  private readonly countTotal = computed(() =>
    cashTotal(this.rows(), this.counts(), parseAmount(this.othersText(), this.i18n.locale()) ?? 0),
  );
  protected readonly calcTotal = computed(() => parseAmount(this.expr(), this.i18n.locale()));
  /** Total de la pestaña abierta; null si todavía no se ha contado nada (para no ajustar a 0 sin querer) */
  protected readonly total = computed(() => {
    if (this.tab() === 'calc') return this.calcTotal();
    const counted = Object.values(this.counts()).some((n) => n > 0) || !!this.othersText().trim();
    return counted ? this.countTotal() : null;
  });
  protected readonly diff = computed(() => {
    const total = this.total();
    return total === null ? null : Math.round((total - this.account().balance) * 100) / 100;
  });

  /** Teclado de la calculadora; la tecla decimal según el idioma */
  protected readonly keys = computed(() => {
    const dec = this.i18n.locale().startsWith('en') ? '.' : ',';
    return [
      'C',
      '⌫',
      '(',
      ')',
      '7',
      '8',
      '9',
      '÷',
      '4',
      '5',
      '6',
      '×',
      '1',
      '2',
      '3',
      '−',
      '0',
      dec,
      '=',
      '+',
    ];
  });

  /** Cuenta del último conteo: al abrir otra cuenta de efectivo se empieza de cero */
  private countedId = '';

  open(): void {
    if (this.countedId !== this.account().id) {
      this.countedId = this.account().id;
      this.counts.set({});
      this.othersText.set('');
      this.expr.set('');
    }
    this.error.set(null);
    openModal(this.dialog().nativeElement);
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected label(value: number): string {
    return denominationLabel(value, this.account().currency, this.i18n.locale());
  }

  protected money(n: number): string {
    return formatMoney(n, this.account().currency, this.i18n.locale());
  }

  protected countOf(key: string): number {
    return this.counts()[key] ?? 0;
  }

  protected setCount(key: string, text: string): void {
    const n = Math.max(0, Math.floor(Number(text) || 0));
    this.counts.update((c) => ({ ...c, [key]: n }));
  }

  protected step(key: string, delta: number): void {
    this.setCount(key, String(this.countOf(key) + delta));
  }

  protected isOperator(key: string): boolean {
    return '÷×−+()'.includes(key);
  }

  protected press(key: string): void {
    if (key === '=') return this.equals();
    this.expr.set(pressKey(this.expr(), key));
  }

  /** "=": la cuenta queda reemplazada por su resultado, para seguir calculando desde ahí */
  protected equals(): void {
    const value = this.calcTotal();
    if (value !== null) this.expr.set(amountForInput(value, this.i18n.locale()));
  }

  protected clear(): void {
    if (this.tab() === 'count') {
      this.counts.set({});
      this.othersText.set('');
    } else {
      this.expr.set('');
    }
    this.error.set(null);
  }

  protected async adjust(): Promise<void> {
    const total = this.total();
    if (total === null || !this.diff() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.adjust(this.account(), {
        id: crypto.randomUUID(),
        balance: total,
        date: localToday(),
        description: this.i18n.t('finance.cash.adjustDescription'),
      });
      this.toast.show(this.i18n.t('finance.cash.adjusted', { amount: this.money(total) }));
      this.close();
      this.saved.emit();
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
