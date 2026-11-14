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
import { kindIcon, localToday } from './finance-logic';
import { Account } from './finance.models';
import { FinanceStore } from './finance.store';
import { amountForInput, parseAmount } from './movement-logic';
import { openModal } from '../../shared/modal';

/**
 * Transferir entre dos cuentas del grupo o pagar una tarjeta.
 * Solo se ofrecen cuentas que la persona puede editar. No lleva categoría.
 */
@Component({
  selector: 'oh-transfer-dialog',
  imports: [TPipe],
  template: `
    <dialog #dialog aria-labelledby="transfer-title">
      <form (submit)="$event.preventDefault(); save()" novalidate>
        <h2 id="transfer-title">
          {{ (paying() ? 'finance.transfers.payTitle' : 'finance.transfers.title') | t }}
        </h2>
        <p class="oh-hint">{{ 'finance.transfers.hint' | t }}</p>

        <div class="accounts">
          <div class="oh-field">
            <label for="transfer-from">{{ 'finance.transfers.from' | t }}</label>
            <select
              id="transfer-from"
              class="oh-input"
              (change)="fromId.set($any($event.target).value)"
            >
              @for (a of editable(); track a.id) {
                <option [value]="a.id" [selected]="a.id === fromId()" [disabled]="a.id === toId()">
                  {{ icon(a) }} {{ a.name }} · {{ money(a.balance) }}
                </option>
              }
            </select>
          </div>
          <button
            type="button"
            class="swap"
            (click)="swap()"
            [attr.aria-label]="'finance.transfers.swap' | t"
          >
            ⇅
          </button>
          <div class="oh-field">
            <label for="transfer-to">{{ 'finance.transfers.to' | t }}</label>
            <select
              id="transfer-to"
              class="oh-input"
              (change)="toId.set($any($event.target).value)"
            >
              @for (a of editable(); track a.id) {
                <option [value]="a.id" [selected]="a.id === toId()" [disabled]="a.id === fromId()">
                  {{ icon(a) }} {{ a.name }} · {{ money(a.balance) }}
                </option>
              }
            </select>
          </div>
        </div>

        @if (to()?.credit; as c) {
          <p class="debt">
            {{ 'finance.transfers.debtOf' | t: { name: to()!.name, amount: money(c.debt) } }}
          </p>
        }

        <div class="oh-field">
          <label for="transfer-amount">{{ 'finance.movements.amount' | t }}</label>
          <input
            #amountInput
            id="transfer-amount"
            class="oh-input big"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0,00"
            [value]="amountText()"
            (input)="amountText.set($any($event.target).value)"
          />
        </div>
        <div class="row">
          <div class="oh-field">
            <label for="transfer-description">{{ 'finance.movements.description' | t }}</label>
            <input
              id="transfer-description"
              class="oh-input"
              maxlength="200"
              [value]="description()"
              (input)="description.set($any($event.target).value)"
            />
          </div>
          <div class="oh-field">
            <label for="transfer-date">{{ 'finance.movements.date' | t }}</label>
            <input
              id="transfer-date"
              class="oh-input"
              type="date"
              [value]="date()"
              (input)="date.set($any($event.target).value)"
            />
          </div>
        </div>

        @if (error(); as e) {
          <p class="oh-alert is-error" role="alert">{{ e }}</p>
        }
        <div class="actions">
          <button type="button" class="oh-btn oh-btn--text" (click)="close()">
            {{ 'finance.cancel' | t }}
          </button>
          <button type="submit" class="oh-btn oh-btn--filled" [disabled]="!canSave()">
            {{ (paying() ? 'finance.transfers.pay' : 'finance.transfers.save') | t }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(94vw, 520px);
      padding: 22px;
      border: 0;
      border-radius: var(--oh-radius-lg);
      background: var(--oh-surface);
      color: var(--oh-text);
      box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
      @media (max-width: 599px) {
        width: 100vw;
        max-width: 100vw;
        margin: auto 0 0;
        border-radius: var(--oh-radius-lg) var(--oh-radius-lg) 0 0;
        padding-bottom: calc(18px + env(safe-area-inset-bottom));
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.4);
    }
    form {
      display: grid;
      gap: 14px;
    }
    h2,
    p {
      margin: 0;
    }
    h2 {
      font-size: 1.125rem;
    }
    .accounts {
      display: grid;
      gap: 6px;
    }
    .swap {
      justify-self: center;
      width: 40px;
      height: 32px;
      border: 1px solid var(--oh-border-strong);
      border-radius: 999px;
      background: var(--oh-surface);
      color: var(--oh-text);
      font-size: 1.1rem;
      cursor: pointer;
    }
    .debt {
      font-size: 0.875rem;
      color: var(--oh-text-muted);
    }
    .big {
      font-size: 1.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .row {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class TransferDialogComponent {
  /** Cuentas activas del grupo (se ofrecen las que la persona puede editar) */
  readonly accounts = input.required<Account[]>();
  readonly saved = output<void>();

  private readonly store = inject(FinanceStore);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly fromId = signal('');
  protected readonly toId = signal('');
  protected readonly amountText = signal('');
  protected readonly description = signal('');
  protected readonly date = signal(localToday());
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly editable = computed(() =>
    this.accounts().filter((a) => a.permissions.canEdit),
  );
  private readonly from = computed(
    () => this.editable().find((a) => a.id === this.fromId()) ?? null,
  );
  protected readonly to = computed(() => this.editable().find((a) => a.id === this.toId()) ?? null);
  /** Pagar tarjeta: el destino es una tarjeta de crédito */
  protected readonly paying = computed(() => this.to()?.kind === 'credit');
  private readonly amount = computed(() => parseAmount(this.amountText(), this.i18n.locale()));
  protected readonly canSave = computed(() => {
    const amount = this.amount();
    return (
      !this.busy() &&
      !!this.from() &&
      !!this.to() &&
      this.fromId() !== this.toId() &&
      amount !== null &&
      amount > 0 &&
      !!this.description().trim() &&
      !!this.date()
    );
  });

  /**
   * @param from cuenta de origen (la hoja abierta al transferir)
   * @param to cuenta de destino (la tarjeta al pagarla); si falta, la primera otra que se pueda editar
   */
  open(options: { from?: Account; to?: Account }): void {
    const others = (id?: string) => this.editable().filter((a) => a.id !== id);
    const to = options.to ?? others(options.from?.id)[0];
    // Al pagar una tarjeta, el origen sugerido es una cuenta que no sea tarjeta
    const from =
      options.from ?? others(to?.id).find((a) => a.kind !== 'credit') ?? others(to?.id)[0];
    this.fromId.set(from?.id ?? '');
    this.toId.set(to?.id ?? '');
    const debt = options.to?.credit?.debt ?? 0;
    this.amountText.set(debt > 0 ? amountForInput(debt, this.i18n.locale()) : '');
    this.description.set(
      this.i18n.t(
        to?.kind === 'credit'
          ? 'finance.transfers.payDescription'
          : 'finance.transfers.defaultDescription',
        { name: to?.name ?? '' },
      ),
    );
    this.date.set(localToday());
    this.error.set(null);
    openModal(this.dialog().nativeElement);
    setTimeout(() => this.amountInput()?.nativeElement.select());
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected swap(): void {
    const from = this.fromId();
    this.fromId.set(this.toId());
    this.toId.set(from);
  }

  protected icon(a: Account): string {
    return kindIcon(a.kind);
  }

  protected money(n: number): string {
    return formatMoney(n, this.accounts()[0]?.currency ?? 'USD', this.i18n.locale());
  }

  async save(): Promise<void> {
    const from = this.from();
    const to = this.to();
    if (!this.canSave() || !from || !to) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.transfer(from, to, {
        id: crypto.randomUUID(),
        outId: crypto.randomUUID(),
        inId: crypto.randomUUID(),
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: this.amount()!,
        date: this.date(),
        description: this.description().trim(),
      });
      this.close();
      this.saved.emit();
    } catch (err) {
      const e = toApiError(err);
      this.error.set(
        this.i18n.error(e.code === 'VALIDATION' ? Object.values(e.fields)[0] : e.code),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
