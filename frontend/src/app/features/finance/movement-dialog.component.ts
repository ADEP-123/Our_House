import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { formatMoney } from '../lists/item-logic';
import { iconOf } from '../lists/list-presets';
import { localToday } from './finance-logic';
import {
  Account,
  AccountSavings,
  BudgetsData,
  Category,
  Movement,
  MovementHistoryEntry,
  MovementSuggestion,
} from './finance.models';
import { FinanceService } from './finance.service';
import { FinanceStore } from './finance.store';
import { amountForInput, parseAmount } from './movement-logic';
import { budgetCrossing, savingsReminder } from './savings-logic';
import { ToastService } from '../../shared/toast.service';

/** null: cerrado; movement null: agregar uno nuevo */
export interface MovementRequest {
  movement: Movement | null;
}

/**
 * Agregar o editar un movimiento. En el celular sube desde abajo; en escritorio es un diálogo centrado.
 * El monto se escribe con el teclado numérico y la descripción sugiere lo que ya se usó (con su categoría).
 */
@Component({
  selector: 'oh-movement-dialog',
  imports: [TPipe],
  templateUrl: './movement-dialog.component.html',
  styleUrl: './movement-dialog.component.scss',
})
export class MovementDialogComponent {
  readonly account = input.required<Account>();
  readonly categories = input.required<Category[]>();
  readonly request = input<MovementRequest | null>(null);
  /** El movimiento se guardó; keepOpen: "Guardar y agregar otro" */
  readonly saved = output<{ keepOpen: boolean }>();
  readonly deleteRequested = output<Movement>();
  readonly closed = output<void>();

  private readonly finance = inject(FinanceService);
  private readonly store = inject(FinanceStore);
  private readonly i18n = inject(I18n);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly iconOf = iconOf;
  protected readonly kind = signal<'in' | 'out'>('out');
  protected readonly amountText = signal('');
  protected readonly description = signal('');
  protected readonly categoryId = signal('');
  protected readonly date = signal(localToday());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly suggestions = signal<MovementSuggestion[]>([]);
  protected readonly history = signal<MovementHistoryEntry[] | null>(null);
  protected readonly addedCount = signal(0);
  protected readonly savingsProjectId = signal('');
  /** Presupuestos del mes (para avisar al cruzar el 80 o el 100 %) */
  private readonly budgets = signal<BudgetsData | null>(null);
  private suggestTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly movement = computed(() => this.request()?.movement ?? null);
  /** Saldo inicial: se cambia desde Editar cuenta. Sin permiso de edición: solo lectura. */
  protected readonly readOnly = computed(() => {
    const m = this.movement();
    return !this.account().permissions.canEdit || m?.kind === 'opening';
  });
  protected readonly isAdjust = computed(() => this.movement()?.kind === 'adjust');
  protected readonly isTransfer = computed(() => !!this.movement()?.transfer);
  /** Sin tipo ni categoría: ajustes, transferencias y saldo inicial */
  protected readonly plain = computed(
    () => this.isAdjust() || this.isTransfer() || this.movement()?.kind === 'opening',
  );
  protected readonly transferText = computed(() => {
    const m = this.movement();
    if (!m?.transfer) return '';
    const name = m.transfer.accountName ?? this.i18n.t('finance.transfers.otherAccount');
    const key =
      m.kind === 'transfer_out' ? 'finance.transfers.towards' : 'finance.transfers.fromAccount';
    return this.i18n.t(key, { name: m.transfer.code ? `${name} · ${m.transfer.code}` : name });
  });
  /** Categoría elegida (para mostrarla en la copia local sin conexión) */
  private readonly category = computed(
    () => this.categories().find((c) => c.id === this.categoryId()) ?? null,
  );
  protected readonly amount = computed(() => parseAmount(this.amountText(), this.i18n.locale()));
  /** Habilitadas, más la actual del movimiento aunque esté deshabilitada */
  protected readonly categoryOptions = computed(() => {
    const current = this.movement()?.category?.id;
    return this.categories().filter((c) => !c.disabled || c.id === current);
  });
  /** Proyectos con ahorro en esta cuenta, más el del movimiento aunque ya no le quede */
  protected readonly savingsOptions = computed(() => {
    const options = [...this.account().savings.projects];
    const current = this.movement()?.savings;
    if (current && !options.some((p) => p.id === current.id))
      options.push({
        id: current.id,
        name: current.name ?? '',
        icon: current.icon ?? '🎯',
        amount: 0,
      });
    return options;
  });
  protected readonly showSavings = computed(
    () => !this.plain() && this.kind() === 'out' && this.savingsOptions().length > 0,
  );
  /** "Recuerda que 8.000 son de ahorro…": la salida se come lo apartado */
  protected readonly reminder = computed(() => {
    if (this.plain() || this.kind() !== 'out' || this.savingsProjectId() || this.readOnly())
      return null;
    const m = this.movement();
    const own = m?.kind === 'out' && !m.savings ? m.amount : 0;
    return savingsReminder(this.account().savings, this.amount(), own);
  });

  protected readonly canSave = computed(() => {
    const amount = this.amount();
    if (this.busy() || !this.description().trim() || !this.date() || amount === null) return false;
    if (this.isAdjust()) return amount !== 0;
    if (this.isTransfer()) return amount > 0;
    return amount > 0 && !!this.categoryId();
  });

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => {
        const el = this.dialog().nativeElement;
        if (!request) {
          if (el.open) el.close();
          return;
        }
        this.reset(request.movement);
        if (!el.open) el.showModal();
        setTimeout(() => this.amountInput()?.nativeElement.select());
      });
    });
  }

  private reset(m: Movement | null, keep?: { kind: 'in' | 'out'; date: string }): void {
    this.error.set(null);
    this.suggestions.set([]);
    this.history.set(null);
    this.kind.set(keep?.kind ?? (m?.kind === 'in' || m?.kind === 'transfer_in' ? 'in' : 'out'));
    this.amountText.set(
      m
        ? amountForInput(m.kind === 'adjust' ? m.amount : Math.abs(m.amount), this.i18n.locale())
        : '',
    );
    this.description.set(m?.description ?? '');
    this.categoryId.set(m?.category?.id ?? '');
    this.date.set(keep?.date ?? m?.date ?? localToday());
    this.savingsProjectId.set(m?.savings?.id ?? '');
    if (!m && !keep) this.addedCount.set(0);
    if (!keep) this.loadBudgets();
  }

  /** Las cuentas privadas no cuentan en el presupuesto del grupo */
  private loadBudgets(): void {
    const account = this.account();
    if (account.viewMode === 'private' || account.permissions.supervision)
      return this.budgets.set(null);
    this.store
      .budgets(account.familyId)
      .then((b) => this.budgets.set(b))
      .catch(() => this.budgets.set(null));
  }

  protected reminderDetail(projects: AccountSavings['projects']): string {
    return projects.map((p) => `${p.name} ${this.money(p.amount)}`).join(', ');
  }

  /** Aviso en la app al cruzar el 80 o el 100 % del presupuesto del mes (los correos los manda el servidor) */
  private budgetToast(previous: Movement | null, amount: number): void {
    const data = this.budgets();
    if (!data || this.kind() !== 'out' || this.date().slice(0, 7) !== data.month) return;
    const budget = data.budgets.find((b) => b.categoryId === this.categoryId());
    if (!budget) return;
    const before =
      previous?.kind === 'out' &&
      previous.category?.id === budget.categoryId &&
      previous.date.slice(0, 7) === data.month
        ? previous.amount
        : 0;
    const add = Math.round((amount - before) * 100) / 100;
    const crossed = budgetCrossing(budget, add);
    const spent = Math.round((budget.spent + add) * 100) / 100;
    this.budgets.set({
      ...data,
      budgets: data.budgets.map((b) =>
        b === budget ? { ...b, spent, pct: Math.round((spent / b.limit) * 100) } : b,
      ),
    });
    if (!crossed) return;
    this.toast.show(
      this.i18n.t(crossed === 100 ? 'finance.budget.toast100' : 'finance.budget.toast80', {
        category: budget.name,
        pct: Math.round((spent / budget.limit) * 100),
        spent: this.money(spent),
        limit: this.money(budget.limit),
      }),
      { durationMs: 8000 },
    );
  }

  protected money(n: number): string {
    return formatMoney(n, this.account().currency, this.i18n.locale());
  }

  protected kindLabel(kind: unknown): string {
    if (kind === 'in') return this.i18n.t('finance.movements.kindIn');
    if (kind === 'out') return this.i18n.t('finance.movements.kindOut');
    return String(kind);
  }

  // ---------- Sugerencias ----------

  protected onDescription(value: string): void {
    this.description.set(value);
    clearTimeout(this.suggestTimer);
    if (this.movement() || value.trim().length < 2) return this.suggestions.set([]);
    this.suggestTimer = setTimeout(async () => {
      const list = await this.store
        .suggestions(this.account().familyId, this.account().id, value.trim())
        .catch(() => []);
      // Si la persona siguió escribiendo, estas ya no aplican
      if (this.description() !== value) return;
      this.suggestions.set(
        list.filter(
          (s) =>
            s.description.toLowerCase() !== value.trim().toLowerCase() ||
            s.categoryId !== this.categoryId(),
        ),
      );
    }, 250);
  }

  protected pick(s: MovementSuggestion): void {
    this.description.set(s.description);
    if (s.categoryId && this.categoryOptions().some((c) => c.id === s.categoryId))
      this.categoryId.set(s.categoryId);
    if (s.kind === 'in' || s.kind === 'out') this.kind.set(s.kind);
    this.suggestions.set([]);
  }

  /** Escape cierra primero las sugerencias y no el diálogo */
  protected closeSuggestions(event: Event): void {
    if (!this.suggestions().length) return;
    event.preventDefault();
    event.stopPropagation();
    this.suggestions.set([]);
  }

  protected categoryLabel(id: string | null): string {
    const c = this.categories().find((x) => x.id === id);
    return c ? `${iconOf(c.icon)} ${c.name}` : '';
  }

  // ---------- Guardar ----------

  async save(keepOpen: boolean): Promise<void> {
    if (!this.canSave()) return;
    const m = this.movement();
    const amount = this.amount()!;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (!m) {
        await this.store.addMovement(
          this.account(),
          {
            id: crypto.randomUUID(),
            kind: this.kind(),
            amount,
            date: this.date(),
            description: this.description().trim(),
            categoryId: this.categoryId(),
            ...(this.kind() === 'out' && this.savingsProjectId()
              ? { savingsProjectId: this.savingsProjectId() }
              : {}),
          },
          this.category(),
        );
      } else if (m.kind === 'adjust' || m.transfer) {
        await this.store.updateMovement(
          this.account(),
          m,
          { amount, date: this.date(), description: this.description().trim() },
          null,
        );
      } else {
        await this.store.updateMovement(
          this.account(),
          m,
          {
            kind: this.kind(),
            amount,
            date: this.date(),
            description: this.description().trim(),
            categoryId: this.categoryId(),
            savingsProjectId: this.kind() === 'out' ? this.savingsProjectId() || null : null,
          },
          this.category(),
        );
      }
      if (!m || (!m.transfer && m.kind !== 'adjust')) this.budgetToast(m, amount);
      this.saved.emit({ keepOpen: keepOpen && !m });
      if (keepOpen && !m) {
        this.addedCount.update((n) => n + 1);
        this.reset(null, { kind: this.kind(), date: this.date() });
        this.amountInput()?.nativeElement.focus();
      } else {
        this.close();
      }
    } catch (err) {
      const e = toApiError(err);
      this.error.set(
        this.i18n.error(e.code === 'VALIDATION' ? Object.values(e.fields)[0] : e.code),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(): void {
    const m = this.movement();
    if (!m) return;
    this.deleteRequested.emit(m);
    this.close();
  }

  // ---------- Historial ----------

  async loadHistory(): Promise<void> {
    const m = this.movement();
    if (!m) return;
    try {
      this.history.set(
        await this.finance.movementHistory(m.id, this.account().permissions.supervision),
      );
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected actionLabel(h: MovementHistoryEntry): string {
    return this.i18n.t(`finance.movements.history.${h.action}`, { name: h.actor?.nickname ?? '—' });
  }

  protected changeLines(h: MovementHistoryEntry): { field: string; from: string; to: string }[] {
    if (!h.changes) return [];
    const show = (field: string, v: unknown): string => {
      if (v === null || v === undefined || v === '') return '—';
      if (field === 'amount') return this.money(Number(v));
      if (field === 'kind') return this.kindLabel(v);
      if (field === 'date') {
        const [y, mo, d] = String(v).split('-').map(Number);
        return new Date(y!, mo! - 1, d!).toLocaleDateString(this.i18n.locale(), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      }
      return String(v);
    };
    return Object.entries(h.changes).map(([field, [from, to]]) => ({
      field: this.i18n.t(
        `finance.movements.fields.${field as 'kind' | 'amount' | 'date' | 'description' | 'category' | 'savings'}`,
      ),
      from: show(field, from),
      to: show(field, to),
    }));
  }

  close(): void {
    const el = this.dialog().nativeElement;
    if (el.open) el.close();
  }

  /** El <dialog> se cerró (botón, Escape o fuera) */
  protected onClosed(): void {
    clearTimeout(this.suggestTimer);
    this.closed.emit();
  }
}
