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
import { IconPickerComponent } from '../lists/icon-picker.component';
import { formatMoney } from '../lists/item-logic';
import { SavingsData, SavingsProject } from './finance.models';
import { amountForInput, parseAmount } from './movement-logic';
import { SavingsService } from './savings.service';
import { openModal } from '../../shared/modal';

const DIALOG_STYLES = `
  dialog {
    width: min(92vw, 440px);
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
  .row {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr 1fr;
  }
  .big {
    font-size: 1.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .amount {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    font-weight: 600;
    font-size: 0.875rem;
  }
`;

/** Crear o editar un proyecto de ahorro: nombre, ícono, meta y fecha meta (opcionales) */
@Component({
  selector: 'oh-savings-project-dialog',
  imports: [TPipe, IconPickerComponent],
  template: `
    <dialog #dialog aria-labelledby="savings-project-title">
      <form (submit)="$event.preventDefault(); save()" novalidate>
        <h2 id="savings-project-title">
          {{ (editing() ? 'finance.savings.editTitle' : 'finance.savings.newTitle') | t }}
        </h2>
        <div class="oh-field">
          <label for="savings-name">{{ 'finance.savings.name' | t }}</label>
          <input
            id="savings-name"
            class="oh-input"
            maxlength="60"
            autocomplete="off"
            [placeholder]="'finance.savings.namePlaceholder' | t"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
          />
        </div>
        <div class="row">
          <div class="oh-field">
            <label for="savings-goal">{{ 'finance.savings.goal' | t }}</label>
            <input
              id="savings-goal"
              class="oh-input"
              inputmode="decimal"
              autocomplete="off"
              [placeholder]="'finance.savings.optional' | t"
              [value]="goal()"
              (input)="goal.set($any($event.target).value)"
            />
          </div>
          <div class="oh-field">
            <label for="savings-date">{{ 'finance.savings.targetDate' | t }}</label>
            <input
              id="savings-date"
              class="oh-input"
              type="date"
              [value]="targetDate()"
              (input)="targetDate.set($any($event.target).value)"
            />
          </div>
        </div>
        <fieldset>
          <legend>{{ 'finance.savings.icon' | t }}</legend>
          <oh-icon-picker [value]="icon()" (valueChange)="icon.set($event)" />
        </fieldset>
        @if (error(); as e) {
          <p class="oh-alert is-error" role="alert">{{ e }}</p>
        }
        <div class="actions">
          <button type="button" class="oh-btn oh-btn--text" (click)="close()">
            {{ 'finance.cancel' | t }}
          </button>
          <button type="submit" class="oh-btn oh-btn--filled" [disabled]="busy() || !name().trim()">
            {{ 'finance.savings.saveProject' | t }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: DIALOG_STYLES,
})
export class SavingsProjectDialogComponent {
  readonly familyId = input.required<string>();
  readonly saved = output<void>();

  private readonly savings = inject(SavingsService);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly editing = signal<SavingsProject | null>(null);
  protected readonly name = signal('');
  protected readonly icon = signal('🎯');
  protected readonly goal = signal('');
  protected readonly targetDate = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  open(project: SavingsProject | null): void {
    this.editing.set(project);
    this.name.set(project?.name ?? '');
    this.icon.set(project?.icon ?? '🎯');
    this.goal.set(project?.goal ? amountForInput(project.goal, this.i18n.locale()) : '');
    this.targetDate.set(project?.targetDate ?? '');
    this.error.set(null);
    openModal(this.dialog().nativeElement);
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected async save(): Promise<void> {
    const goalText = this.goal().trim();
    const goal = goalText ? parseAmount(goalText, this.i18n.locale()) : null;
    if (goalText && (goal === null || goal <= 0))
      return this.error.set(this.i18n.error('SAVINGS_GOAL_INVALID'));
    const input = {
      name: this.name().trim(),
      icon: this.icon(),
      goal,
      targetDate: this.targetDate() || null,
    };
    this.busy.set(true);
    try {
      const current = this.editing();
      if (current) await this.savings.update(current.id, input);
      else await this.savings.create(this.familyId(), { id: crypto.randomUUID(), ...input });
      this.close();
      this.saved.emit();
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Apartar dinero de una cuenta para un proyecto, o liberarlo */
@Component({
  selector: 'oh-savings-move-dialog',
  imports: [TPipe],
  template: `
    <dialog #dialog aria-labelledby="savings-move-title">
      @if (project(); as p) {
        <form (submit)="$event.preventDefault(); save()" novalidate>
          <h2 id="savings-move-title">
            {{
              (action() === 'set_aside'
                ? 'finance.savings.setAsideTitle'
                : 'finance.savings.releaseTitle'
              ) | t: { name: p.icon + ' ' + p.name }
            }}
          </h2>
          <div class="oh-field">
            <label for="savings-account">{{ 'finance.savings.account' | t }}</label>
            <select
              id="savings-account"
              class="oh-input"
              (change)="accountId.set($any($event.target).value)"
            >
              @for (a of options(); track a.id) {
                <option [value]="a.id" [selected]="a.id === accountId()">
                  {{ a.name }} · {{ money(a.max) }}
                </option>
              }
            </select>
            <p class="oh-hint">
              {{
                (action() === 'set_aside'
                  ? 'finance.savings.availableHint'
                  : 'finance.savings.savedHint'
                ) | t: { amount: money(max()) }
              }}
            </p>
          </div>
          <div class="oh-field">
            <label for="savings-amount">{{ 'finance.savings.amount' | t }}</label>
            <div class="amount">
              <input
                #amountInput
                id="savings-amount"
                class="oh-input big"
                inputmode="decimal"
                autocomplete="off"
                [value]="text()"
                (input)="text.set($any($event.target).value)"
              />
              <button type="button" class="oh-btn oh-btn--text" (click)="all()">
                {{ 'finance.savings.all' | t }}
              </button>
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
              {{
                (action() === 'set_aside' ? 'finance.savings.setAside' : 'finance.savings.release')
                  | t
              }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: DIALOG_STYLES,
})
export class SavingsMoveDialogComponent {
  readonly data = input.required<SavingsData>();
  readonly saved = output<void>();

  private readonly savings = inject(SavingsService);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly project = signal<SavingsProject | null>(null);
  protected readonly action = signal<'set_aside' | 'release'>('set_aside');
  protected readonly accountId = signal('');
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Apartar: cuentas que la persona edita, con su disponible. Liberar: donde el proyecto tiene dinero. */
  protected readonly options = computed(() => {
    const p = this.project();
    if (!p) return [];
    const editable = this.data().accounts.filter((a) => a.canEdit);
    if (this.action() === 'set_aside')
      return editable.map((a) => ({ id: a.id, name: a.name, max: a.available }));
    return editable
      .map((a) => ({
        id: a.id,
        name: a.name,
        max: p.accounts.find((x) => x.accountId === a.id)?.amount ?? 0,
      }))
      .filter((a) => a.max > 0);
  });
  protected readonly max = computed(
    () => this.options().find((a) => a.id === this.accountId())?.max ?? 0,
  );
  protected readonly amount = computed(() => parseAmount(this.text(), this.i18n.locale()));
  protected readonly canSave = computed(() => {
    const amount = this.amount();
    return !this.busy() && !!this.accountId() && amount !== null && amount > 0;
  });

  open(project: SavingsProject, action: 'set_aside' | 'release', accountId?: string): void {
    this.project.set(project);
    this.action.set(action);
    const options = this.options();
    this.accountId.set(options.find((a) => a.id === accountId)?.id ?? options[0]?.id ?? '');
    this.text.set('');
    this.error.set(null);
    openModal(this.dialog().nativeElement);
    this.amountInput()?.nativeElement.focus();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected all(): void {
    const value = amountForInput(this.max(), this.i18n.locale());
    this.text.set(value);
    // El campo se actualiza ya mismo (no al redibujar), por si se sigue escribiendo enseguida
    const input = this.amountInput()?.nativeElement;
    if (input) input.value = value;
  }

  protected money(n: number): string {
    return formatMoney(n, this.data().currency, this.i18n.locale());
  }

  protected async save(): Promise<void> {
    const p = this.project();
    const amount = this.amount();
    if (!p || amount === null || !this.canSave()) return;
    this.busy.set(true);
    try {
      await this.savings.move(p.id, this.accountId(), this.action(), amount);
      this.close();
      this.saved.emit();
    } catch (err) {
      const e = toApiError(err);
      this.error.set(this.i18n.error(e.code, { amount: this.money(this.max()) }));
    } finally {
      this.busy.set(false);
    }
  }
}
