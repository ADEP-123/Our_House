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
import { formatMoney } from '../lists/item-logic';
import { AmountInputDirective } from './amount-input.directive';
import { interestOf } from './debt-logic';
import { DebtsService } from './debts.service';
import { localToday } from './finance-logic';
import {
  Account,
  Category,
  Debt,
  DebtDirection,
  DebtEntryKind,
  DebtViewMode,
} from './finance.models';
import { amountForInput, parseAmount } from './movement-logic';

/** Mensaje de un error de la API: el del primer campo si es de validación */
function errorText(i18n: I18n, err: unknown): string {
  const e = toApiError(err);
  return i18n.error(e.code === 'VALIDATION' ? (Object.values(e.fields)[0] ?? e.code) : e.code);
}

/** Crear o editar una deuda: quién debe, título, persona, monto, fecha, cuotas, interés y quién la ve */
@Component({
  selector: 'oh-debt-dialog',
  imports: [TPipe, AmountInputDirective],
  template: `
    <dialog #dialog aria-labelledby="debt-title">
      <form (submit)="$event.preventDefault(); save()" novalidate>
        <h2 id="debt-title">
          {{ (editing() ? 'finance.debts.formEdit' : 'finance.debts.formNew') | t }}
        </h2>

        <fieldset>
          <legend>{{ 'finance.debts.direction' | t }}</legend>
          <div class="seg" role="group">
            <button
              type="button"
              [attr.aria-pressed]="direction() === 'owe'"
              (click)="direction.set('owe')"
            >
              {{ 'finance.debts.owe' | t }}
            </button>
            <button
              type="button"
              [attr.aria-pressed]="direction() === 'owed'"
              (click)="direction.set('owed')"
            >
              {{ 'finance.debts.owed' | t }}
            </button>
          </div>
        </fieldset>

        <div class="oh-field">
          <label for="debt-name">{{ 'finance.debts.fieldTitle' | t }}</label>
          <input
            id="debt-name"
            class="oh-input"
            maxlength="80"
            autocomplete="off"
            [placeholder]="'finance.debts.titlePlaceholder' | t"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
          />
        </div>
        <div class="row">
          <div class="oh-field">
            <label for="debt-person">{{
              (direction() === 'owe' ? 'finance.debts.personOwe' : 'finance.debts.personOwed') | t
            }}</label>
            <input
              id="debt-person"
              class="oh-input"
              maxlength="60"
              autocomplete="off"
              [value]="person()"
              (input)="person.set($any($event.target).value)"
            />
          </div>
          <div class="oh-field">
            <label for="debt-amount">{{ 'finance.debts.amount' | t }}</label>
            <input
              id="debt-amount"
              class="oh-input"
              ohAmount
              inputmode="decimal"
              autocomplete="off"
              aria-describedby="debt-amount-hint"
              [value]="amount()"
              (input)="amount.set($any($event.target).value)"
            />
          </div>
        </div>
        <p id="debt-amount-hint" class="oh-hint">{{ 'finance.debts.amountHint' | t }}</p>

        <div class="oh-field">
          <label for="debt-description">{{ 'finance.debts.description' | t }}</label>
          <input
            id="debt-description"
            class="oh-input"
            maxlength="280"
            autocomplete="off"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
          />
        </div>

        <div class="row">
          <div class="oh-field">
            <label for="debt-due">{{ 'finance.debts.dueDate' | t }}</label>
            <input
              id="debt-due"
              class="oh-input"
              type="date"
              aria-describedby="debt-due-hint"
              [value]="dueDate()"
              (input)="dueDate.set($any($event.target).value)"
            />
          </div>
          <div class="oh-field">
            <label for="debt-installments">{{ 'finance.debts.installments' | t }}</label>
            <input
              id="debt-installments"
              class="oh-input"
              type="number"
              inputmode="numeric"
              min="2"
              max="600"
              [value]="installments()"
              (input)="installments.set($any($event.target).value)"
            />
          </div>
        </div>
        <p id="debt-due-hint" class="oh-hint">{{ 'finance.debts.dueHint' | t }}</p>

        <div class="row">
          <div class="oh-field">
            <label for="debt-interest">{{ 'finance.debts.interestRate' | t }}</label>
            <input
              id="debt-interest"
              class="oh-input"
              inputmode="decimal"
              autocomplete="off"
              [value]="interest()"
              (input)="interest.set($any($event.target).value)"
            />
          </div>
          <div class="oh-field">
            <label for="debt-period">{{ 'finance.debts.period' | t }}</label>
            <select
              id="debt-period"
              class="oh-input"
              [disabled]="!interest().trim()"
              [value]="period()"
              (change)="period.set($any($event.target).value)"
            >
              <option value="monthly">{{ 'finance.debts.monthly' | t }}</option>
              <option value="annual">{{ 'finance.debts.annual' | t }}</option>
            </select>
          </div>
        </div>

        <fieldset>
          <legend>{{ 'finance.debts.visibility' | t }}</legend>
          <div class="seg" role="group">
            @for (v of viewModes; track v.id) {
              <button
                type="button"
                [attr.aria-pressed]="viewMode() === v.id"
                (click)="viewMode.set(v.id)"
              >
                {{ v.label | t }}
              </button>
            }
          </div>
          @if (viewMode() === 'members') {
            <div class="people">
              @for (m of others(); track m.userId) {
                <label class="person">
                  <input
                    type="checkbox"
                    [checked]="viewers().has(m.userId)"
                    (change)="toggleViewer(m.userId)"
                  />
                  <span>{{ m.nickname }}</span>
                </label>
              }
            </div>
          }
          <p class="oh-hint">{{ 'finance.debts.editNote' | t }}</p>
        </fieldset>

        @if (error(); as e) {
          <p class="oh-alert is-error" role="alert">{{ e }}</p>
        }
        <div class="actions">
          <button type="button" class="oh-btn oh-btn--text" (click)="close()">
            {{ 'finance.debts.cancel' | t }}
          </button>
          <button
            type="submit"
            class="oh-btn oh-btn--filled"
            [disabled]="busy() || !title().trim() || !person().trim()"
          >
            {{ 'finance.debts.save' | t }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: './debt-dialogs.scss',
})
export class DebtDialogComponent {
  readonly familyId = input.required<string>();
  /** Personas del grupo (sin quien crea la deuda) para "Personas elegidas" */
  readonly members = input<{ userId: string; nickname: string }[]>([]);
  readonly saved = output<void>();

  private readonly debts = inject(DebtsService);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly viewModes: {
    id: DebtViewMode;
    label: 'finance.debts.viewFamily' | 'finance.debts.viewMembers' | 'finance.debts.viewPrivate';
  }[] = [
    { id: 'family', label: 'finance.debts.viewFamily' },
    { id: 'members', label: 'finance.debts.viewMembers' },
    { id: 'private', label: 'finance.debts.viewPrivate' },
  ];

  protected readonly editing = signal<Debt | null>(null);
  protected readonly direction = signal<DebtDirection>('owe');
  protected readonly title = signal('');
  protected readonly person = signal('');
  protected readonly amount = signal('');
  protected readonly description = signal('');
  protected readonly dueDate = signal('');
  protected readonly installments = signal('');
  protected readonly interest = signal('');
  protected readonly period = signal<'monthly' | 'annual'>('monthly');
  protected readonly viewMode = signal<DebtViewMode>('family');
  protected readonly viewers = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly others = computed(() => {
    const owner = this.editing()?.owner?.id;
    return this.members().filter((m) => m.userId !== owner);
  });

  open(debt: Debt | null, direction: DebtDirection = 'owe'): void {
    const locale = this.i18n.locale();
    this.editing.set(debt);
    this.direction.set(debt?.direction ?? direction);
    this.title.set(debt?.title ?? '');
    this.person.set(debt?.counterparty ?? '');
    this.amount.set(debt ? amountForInput(debt.amount, locale) : '');
    this.description.set(debt?.description ?? '');
    this.dueDate.set(debt?.dueDate ?? '');
    this.installments.set(debt?.installments ? String(debt.installments.total) : '');
    this.interest.set(debt?.interest ? amountForInput(debt.interest.rate, locale) : '');
    this.period.set(debt?.interest?.period ?? 'monthly');
    this.viewMode.set(debt?.viewMode ?? 'family');
    this.viewers.set(new Set(debt?.viewers ?? []));
    this.error.set(null);
    openModal(this.dialog().nativeElement);
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected toggleViewer(id: string): void {
    const next = new Set(this.viewers());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.viewers.set(next);
  }

  protected async save(): Promise<void> {
    const locale = this.i18n.locale();
    const amount = parseAmount(this.amount(), locale);
    if (amount === null || amount <= 0)
      return this.error.set(this.i18n.error('DEBT_AMOUNT_INVALID'));
    const rateText = this.interest().trim();
    const rate = rateText ? parseAmount(rateText, locale) : null;
    if (rateText && (rate === null || rate <= 0 || rate > 100))
      return this.error.set(this.i18n.error('DEBT_INTEREST_INVALID'));
    const installments = this.installments().trim()
      ? Math.round(Number(this.installments()))
      : null;
    if (installments !== null && !(installments >= 2 && installments <= 600))
      return this.error.set(this.i18n.error('DEBT_INSTALLMENTS_INVALID'));
    const input = {
      direction: this.direction(),
      title: this.title().trim(),
      description: this.description().trim() || null,
      counterparty: this.person().trim(),
      amount,
      dueDate: this.dueDate() || null,
      installments,
      interestRate: rate,
      interestPeriod: rate ? this.period() : null,
      viewMode: this.viewMode(),
      viewers: this.viewMode() === 'members' ? [...this.viewers()] : [],
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const current = this.editing();
      if (current) await this.debts.update(current.id, input);
      else await this.debts.create(this.familyId(), { id: crypto.randomUUID(), ...input });
      this.close();
      this.saved.emit();
    } catch (err) {
      this.error.set(errorText(this.i18n, err));
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Abono (con la opción de registrar el movimiento en una cuenta) o cambio de monto
 * (aumentar por interés o recargo, disminuir por descuento o ajuste).
 */
@Component({
  selector: 'oh-debt-entry-dialog',
  imports: [TPipe, AmountInputDirective],
  template: `
    <dialog #dialog aria-labelledby="debt-entry-title">
      @if (debt(); as d) {
        <form (submit)="$event.preventDefault(); save()" novalidate>
          <h2 id="debt-entry-title">
            @if (mode() === 'payment') {
              {{
                (d.direction === 'owe' ? 'finance.debts.payTitle' : 'finance.debts.collectTitle')
                  | t: { title: d.title, person: d.counterparty }
              }}
            } @else {
              {{ 'finance.debts.changeTitle' | t: { title: d.title } }}
            }
          </h2>
          <p class="oh-hint">{{ 'finance.debts.remaining' | t: { amount: money(d.balance) } }}</p>

          @if (mode() === 'change') {
            <div class="seg" role="group">
              <button
                type="button"
                [attr.aria-pressed]="kind() === 'increase'"
                (click)="kind.set('increase')"
              >
                {{ 'finance.debts.increase' | t }}
              </button>
              <button
                type="button"
                [attr.aria-pressed]="kind() === 'decrease'"
                (click)="kind.set('decrease')"
              >
                {{ 'finance.debts.decrease' | t }}
              </button>
            </div>
          }

          <div class="oh-field">
            <label for="debt-entry-amount">{{ 'finance.debts.amount' | t }}</label>
            <div class="amount">
              <input
                #amountInput
                id="debt-entry-amount"
                class="oh-input big"
                ohAmount
                inputmode="decimal"
                autocomplete="off"
                [value]="amount()"
                (input)="amount.set($any($event.target).value)"
              />
            </div>
            <div class="quick">
              @if (mode() === 'payment') {
                <button type="button" class="oh-btn oh-btn--text" (click)="fill(d.balance)">
                  {{ 'finance.debts.all' | t: { amount: money(d.balance) } }}
                </button>
                @if (d.installments; as i) {
                  <button type="button" class="oh-btn oh-btn--text" (click)="fill(i.each)">
                    {{
                      'finance.debts.installment'
                        | t: { amount: money(i.each), paid: i.paid, total: i.total }
                    }}
                  </button>
                }
              } @else if (d.interest && kind() === 'increase') {
                <button
                  type="button"
                  class="oh-btn oh-btn--text interest"
                  (click)="fill(interestAmount())"
                >
                  {{
                    'finance.debts.calcInterest'
                      | t: { rate: d.interest.rate, amount: money(interestAmount()) }
                  }}
                </button>
              }
            </div>
          </div>

          <div class="row">
            <div class="oh-field">
              <label for="debt-entry-date">{{ 'finance.debts.date' | t }}</label>
              <input
                id="debt-entry-date"
                class="oh-input"
                type="date"
                [value]="date()"
                (input)="date.set($any($event.target).value)"
              />
            </div>
            <div class="oh-field">
              <label for="debt-entry-note">{{ 'finance.debts.note' | t }}</label>
              <input
                id="debt-entry-note"
                class="oh-input"
                maxlength="200"
                autocomplete="off"
                [value]="note()"
                (input)="note.set($any($event.target).value)"
              />
            </div>
          </div>

          @if (mode() === 'payment') {
            <label class="person">
              <input
                type="checkbox"
                [checked]="useAccount()"
                (change)="useAccount.set(!useAccount())"
              />
              <span>{{ 'finance.debts.useAccount' | t }}</span>
            </label>
            @if (useAccount()) {
              @if (accounts().length) {
                <p class="oh-hint">
                  {{
                    (d.direction === 'owe'
                      ? 'finance.debts.useAccountOut'
                      : 'finance.debts.useAccountIn'
                    ) | t
                  }}
                </p>
                <div class="row">
                  <div class="oh-field">
                    <label for="debt-entry-account">{{ 'finance.debts.account' | t }}</label>
                    <select
                      id="debt-entry-account"
                      class="oh-input"
                      [value]="accountId()"
                      (change)="accountId.set($any($event.target).value)"
                    >
                      @for (a of accounts(); track a.id) {
                        <option [value]="a.id">{{ a.name }}</option>
                      }
                    </select>
                  </div>
                  <div class="oh-field">
                    <label for="debt-entry-category">{{ 'finance.debts.category' | t }}</label>
                    <select
                      id="debt-entry-category"
                      class="oh-input"
                      [value]="categoryId()"
                      (change)="categoryId.set($any($event.target).value)"
                    >
                      @for (c of categories(); track c.id) {
                        <option [value]="c.id">{{ c.name }}</option>
                      }
                    </select>
                  </div>
                </div>
              } @else {
                <p class="oh-hint">{{ 'finance.debts.noAccounts' | t }}</p>
              }
            }
          }

          @if (error(); as e) {
            <p class="oh-alert is-error" role="alert">{{ e }}</p>
          }
          <div class="actions">
            <button type="button" class="oh-btn oh-btn--text" (click)="close()">
              {{ 'finance.debts.cancel' | t }}
            </button>
            <button type="submit" class="oh-btn oh-btn--filled" [disabled]="busy() || !valid()">
              {{ 'finance.debts.register' | t }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
  styleUrl: './debt-dialogs.scss',
})
export class DebtEntryDialogComponent {
  readonly currency = input.required<string>();
  /** Cuentas donde la persona puede registrar movimientos */
  readonly accounts = input<Account[]>([]);
  readonly categories = input<Category[]>([]);
  readonly saved = output<void>();

  private readonly debts = inject(DebtsService);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly debt = signal<Debt | null>(null);
  protected readonly mode = signal<'payment' | 'change'>('payment');
  protected readonly kind = signal<Exclude<DebtEntryKind, 'payment'>>('increase');
  protected readonly amount = signal('');
  protected readonly date = signal(localToday());
  protected readonly note = signal('');
  protected readonly useAccount = signal(false);
  protected readonly accountId = signal('');
  protected readonly categoryId = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly value = computed(() => parseAmount(this.amount(), this.i18n.locale()));
  protected readonly valid = computed(() => {
    const v = this.value();
    if (v === null || v <= 0) return false;
    if (this.mode() === 'payment' && this.useAccount())
      return !!this.accountId() && !!this.categoryId();
    return true;
  });
  protected readonly interestAmount = computed(() => {
    const d = this.debt();
    return d?.interest ? interestOf(d.balance, d.interest.rate) : 0;
  });

  open(debt: Debt, mode: 'payment' | 'change'): void {
    this.debt.set(debt);
    this.mode.set(mode);
    this.kind.set('increase');
    this.amount.set('');
    this.date.set(localToday());
    this.note.set('');
    this.useAccount.set(false);
    this.accountId.set(this.accounts()[0]?.id ?? '');
    this.categoryId.set(this.categories()[0]?.id ?? '');
    this.error.set(null);
    openModal(this.dialog().nativeElement);
    setTimeout(() => this.amountInput()?.nativeElement.focus());
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected money(n: number): string {
    return formatMoney(n, this.currency(), this.i18n.locale());
  }

  protected fill(n: number): void {
    this.amount.set(amountForInput(n, this.i18n.locale()));
  }

  protected async save(): Promise<void> {
    const d = this.debt();
    const amount = this.value();
    if (!d || amount === null || !this.valid()) return;
    const payment = this.mode() === 'payment';
    const withAccount = payment && this.useAccount();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.debts.addEntry(d.id, {
        id: crypto.randomUUID(),
        kind: payment ? 'payment' : this.kind(),
        amount,
        date: this.date() || localToday(),
        note: this.note().trim() || null,
        accountId: withAccount ? this.accountId() : null,
        categoryId: withAccount ? this.categoryId() : null,
      });
      this.close();
      this.saved.emit();
    } catch (err) {
      this.error.set(errorText(this.i18n, err));
    } finally {
      this.busy.set(false);
    }
  }
}
