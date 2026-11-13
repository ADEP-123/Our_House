import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ToastService } from '../../shared/toast.service';
import { localToday } from '../finance/finance-logic';
import { formatMoney } from './item-logic';
import { iconOf } from './list-presets';
import { ListPaymentSummary, ListPaymentsService } from './list-payments.service';
import { ListDetail } from './lists.models';

/** Valor del selector de cuenta para "No registrar" */
const NONE = 'none';

/**
 * Barra de "Registrar pago" en una lista de compras: lo pagado desde el último pago,
 * el botón que lo anota como un solo gasto en la cuenta elegida y el último pago hecho.
 */
@Component({
  selector: 'oh-list-payment',
  imports: [TPipe],
  template: `
    @if (data(); as d) {
      @if (d.total > 0 || d.recent.length) {
        <div class="pay">
          @if (d.total > 0) {
            <span class="due"
              >🧾 {{ 'lists.payment.pending' | t: { amount: money(d.total) } }}</span
            >
            @if (d.canRegister) {
              <button
                type="button"
                class="oh-btn oh-btn--tonal"
                [disabled]="!sync.online()"
                (click)="open()"
              >
                {{ 'lists.payment.register' | t }}
              </button>
            }
          }
          @if (d.recent[0]; as p) {
            <span class="oh-hint last">{{ lastLabel(p) }}</span>
          }
        </div>
        @if (d.total > 0 && d.canRegister && !sync.online()) {
          <p class="oh-hint">{{ 'lists.payment.offline' | t }}</p>
        }
      }
    }

    <dialog #dialog aria-labelledby="payment-title" (close)="busy.set(false)">
      @if (data(); as d) {
        <form (submit)="$event.preventDefault(); save()" novalidate>
          <h2 id="payment-title">{{ 'lists.payment.title' | t }}</h2>
          <p class="oh-muted">{{ 'lists.payment.intro' | t }}</p>
          <ul class="items">
            @for (i of d.items; track i.id) {
              <li>
                <span>{{ i.text }}</span
                ><span>{{ money(i.amount) }}</span>
              </li>
            }
            <li class="total">
              <span>{{ 'lists.payment.total' | t }}</span
              ><strong>{{ money(d.total) }}</strong>
            </li>
          </ul>

          <div class="oh-field">
            <label for="payment-account">{{ 'lists.payment.account' | t }}</label>
            <select
              id="payment-account"
              class="oh-input"
              [value]="account()"
              (change)="account.set($any($event.target).value)"
            >
              @for (a of d.accounts; track a.id) {
                <option [value]="a.id">{{ a.name }}</option>
              }
              <option [value]="none">{{ 'lists.payment.noRegister' | t }}</option>
            </select>
            @if (!d.accounts.length) {
              <p class="oh-hint">{{ 'lists.payment.noAccounts' | t }}</p>
            }
          </div>

          @if (account() !== none) {
            <div class="row">
              <div class="oh-field">
                <label for="payment-category">{{ 'lists.payment.category' | t }}</label>
                <select
                  id="payment-category"
                  class="oh-input"
                  [value]="category()"
                  (change)="category.set($any($event.target).value)"
                >
                  @if (!category()) {
                    <option value="">{{ 'lists.payment.chooseCategory' | t }}</option>
                  }
                  @for (c of d.categories; track c.id) {
                    <option [value]="c.id">{{ iconOf(c.icon) }} {{ c.name }}</option>
                  }
                </select>
              </div>
              <div class="oh-field">
                <label for="payment-date">{{ 'lists.payment.date' | t }}</label>
                <input
                  id="payment-date"
                  class="oh-input"
                  type="date"
                  [value]="date()"
                  (input)="date.set($any($event.target).value)"
                />
              </div>
            </div>
          }

          @if (error(); as err) {
            <p class="oh-alert is-error" role="alert">{{ err }}</p>
          }
          <div class="actions">
            <button type="button" class="oh-btn oh-btn--text" (click)="close()">
              {{ 'lists.items.cancel' | t }}
            </button>
            <button type="submit" class="oh-btn oh-btn--filled" [disabled]="!valid()">
              {{
                (account() === none ? 'lists.payment.confirmNoRegister' : 'lists.payment.confirm')
                  | t
              }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .pay {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
      margin-top: 8px;
    }
    .due {
      font-weight: 600;
    }
    .last {
      flex-basis: 100%;
    }
    dialog {
      width: min(92vw, 440px);
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
    }
    .items {
      display: grid;
      gap: 4px;
      max-height: 220px;
      overflow-y: auto;
      margin: 0;
      padding: 10px 14px;
      list-style: none;
      border-radius: 12px;
      background: color-mix(in srgb, var(--oh-text) 5%, var(--oh-surface));
    }
    .items li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-variant-numeric: tabular-nums;
    }
    .items li span:first-child {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .items .total {
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px solid var(--oh-border);
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
    }
    @media (max-width: 420px) {
      .row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class ListPaymentComponent {
  readonly list = input.required<ListDetail>();

  private readonly payments = inject(ListPaymentsService);
  private readonly i18n = inject(I18n);
  private readonly toast = inject(ToastService);
  protected readonly sync = inject(SyncStatus);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly none = NONE;
  protected readonly iconOf = iconOf;
  protected readonly data = this.payments.data;
  protected readonly account = signal<string>(NONE);
  protected readonly category = signal('');
  protected readonly date = signal(localToday());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private paymentId = crypto.randomUUID();

  protected readonly valid = computed(
    () =>
      !this.busy() &&
      (this.account() === NONE || (!!this.category() && /^\d{4}-\d{2}-\d{2}$/.test(this.date()))),
  );

  constructor() {
    // Se trae de nuevo cuando cambia lo pagado en la lista (propio o de otra persona)
    const key = computed(() => {
      const l = this.list();
      return l.features.includes('purchases') && !l.permissions.supervision
        ? `${l.id}|${l.spent}|${l.updatedAt}|${l.counts.completed}`
        : null;
    });
    effect(() => {
      const k = key();
      if (!k) return;
      untracked(() => {
        this.payments.open(this.list().id);
        void this.payments.refresh();
      });
    });
  }

  protected money(value: number): string {
    return formatMoney(value, this.data()?.currency ?? this.list().currency, this.i18n.locale());
  }

  protected lastLabel(p: ListPaymentSummary): string {
    const where = !p.registered
      ? this.i18n.t('lists.payment.lastNotRegistered')
      : p.movementDeleted
        ? this.i18n.t('lists.payment.lastDeleted')
        : [p.account?.name, p.movementCode].filter(Boolean).join(' ');
    return this.i18n.t('lists.payment.last', {
      amount: this.money(p.amount),
      where,
      who: p.by?.nickname ?? '—',
    });
  }

  async open(): Promise<void> {
    await this.payments.refresh();
    const d = this.data();
    if (!d || d.total <= 0) return;
    this.account.set(d.accountId ?? d.accounts[0]?.id ?? NONE);
    this.category.set(
      d.categoryId && d.categories.some((c) => c.id === d.categoryId) ? d.categoryId : '',
    );
    this.date.set(localToday());
    this.error.set(null);
    this.paymentId = crypto.randomUUID();
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  async save(): Promise<void> {
    if (!this.valid()) return;
    const accountId = this.account() === NONE ? null : this.account();
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.payments.register({
        id: this.paymentId,
        accountId,
        ...(accountId ? { categoryId: this.category(), date: this.date() } : {}),
      });
      this.close();
      const name = this.data()?.accounts.find((a) => a.id === accountId)?.name ?? '';
      this.toast.show(
        accountId
          ? this.i18n.t('lists.payment.done', {
              amount: this.money(result.amount),
              account: name,
              code: result.movementCode ?? '',
            })
          : this.i18n.t('lists.payment.doneNoRegister', { amount: this.money(result.amount) }),
      );
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
      void this.payments.refresh();
    } finally {
      this.busy.set(false);
    }
  }
}
