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
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ToastService } from '../../shared/toast.service';
import { formatMoney } from '../lists/item-logic';
import { colorOf, iconOf } from '../lists/list-presets';
import { AdjustDialogComponent } from './adjust-dialog.component';
import { Account, Category, Movement, MovementColumn } from './finance.models';
import { FinanceService } from './finance.service';
import { MovementDialogComponent, MovementRequest } from './movement-dialog.component';
import {
  EMPTY_FILTERS,
  HIDEABLE_COLUMNS,
  MovementFilters,
  filterMovements,
  hasFilters,
} from './movement-logic';

const PAGE = 150;

/**
 * Hoja de una cuenta: movimientos con saldo acumulado, búsqueda y filtros con su total,
 * columnas que cada persona oculta, agregar rápido, editar, borrar con deshacer y ajustar saldo.
 */
@Component({
  selector: 'oh-movements',
  imports: [TPipe, MovementDialogComponent, AdjustDialogComponent],
  templateUrl: './movements.component.html',
  styleUrl: './movements.component.scss',
})
export class MovementsComponent {
  readonly account = input.required<Account>();
  /** Algo cambió el saldo: la pantalla vuelve a pedir las cuentas */
  readonly changed = output<void>();

  private readonly finance = inject(FinanceService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly hideable = HIDEABLE_COLUMNS;
  protected readonly iconOf = iconOf;
  protected readonly colorOf = colorOf;
  protected readonly movements = signal<Movement[] | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly hidden = signal<Set<MovementColumn>>(new Set());
  protected readonly filters = signal<MovementFilters>(EMPTY_FILTERS);
  protected readonly newestFirst = signal(true);
  protected readonly limit = signal(PAGE);
  protected readonly error = signal<string | null>(null);
  protected readonly request = signal<MovementRequest | null>(null);

  protected readonly filtered = computed(() =>
    filterMovements(this.movements() ?? [], this.filters()),
  );
  protected readonly filtering = computed(() => hasFilters(this.filters()));
  protected readonly rows = computed(() => {
    const rows = this.filtered().rows;
    return (this.newestFirst() ? [...rows].reverse() : rows).slice(0, this.limit());
  });
  protected readonly more = computed(() => this.filtered().rows.length - this.rows().length);
  protected readonly show = (c: MovementColumn) => !this.hidden().has(c);
  protected readonly canEdit = computed(() => this.account().permissions.canEdit);
  private loadedFamily: string | null = null;

  /** Solo al cambiar de cuenta (no cuando llega la misma cuenta con el saldo nuevo) */
  private readonly accountId = computed(() => this.account().id);

  constructor() {
    effect(() => {
      this.accountId();
      untracked(() => {
        const a = this.account();
        this.filters.set(EMPTY_FILTERS);
        this.limit.set(PAGE);
        void this.load(a);
        if (this.loadedFamily !== a.familyId) {
          this.loadedFamily = a.familyId;
          void this.finance
            .categories(a.familyId)
            .then((c) => this.categories.set(c.categories))
            .catch(() => this.categories.set([]));
        }
      });
    });
  }

  private async load(a: Account): Promise<void> {
    try {
      const data = await this.finance.movements(a.id, a.permissions.supervision);
      if (this.account().id !== a.id) return; // cambió de pestaña mientras tanto
      this.movements.set(data.movements);
      this.hidden.set(new Set(data.hiddenColumns));
      this.error.set(null);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected async refresh(): Promise<void> {
    await this.load(this.account());
    this.changed.emit();
  }

  // ---------- Formato ----------

  protected money(n: number): string {
    return formatMoney(n, this.account().currency, this.i18n.locale());
  }

  protected date(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected columnLabel(c: MovementColumn): string {
    return this.i18n.t(`finance.movements.columns.${c}` as TranslationKey);
  }

  // ---------- Filtros y columnas ----------

  protected setFilter(changes: Partial<MovementFilters>): void {
    this.filters.update((f) => ({ ...f, ...changes }));
    this.limit.set(PAGE);
  }

  protected clearFilters(): void {
    this.filters.set(EMPTY_FILTERS);
  }

  async toggleColumn(c: MovementColumn): Promise<void> {
    const next = new Set(this.hidden());
    if (next.has(c)) next.delete(c);
    else next.add(c);
    this.hidden.set(next);
    await this.finance.setHiddenColumns(this.account().id, [...next]).catch(() => undefined);
  }

  // ---------- Agregar, editar, borrar ----------

  openNew(): void {
    this.request.set({ movement: null });
  }

  protected open(m: Movement): void {
    this.request.set({ movement: m });
  }

  protected async onSaved(): Promise<void> {
    await this.refresh();
  }

  protected async onDelete(m: Movement): Promise<void> {
    try {
      await this.finance.deleteMovement(m.id);
      await this.refresh();
      this.toast.show(this.i18n.t('finance.movements.deleted', { code: m.code }), {
        actionLabel: this.i18n.t('finance.movements.undo'),
        action: () => void this.undo(m),
      });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  private async undo(m: Movement): Promise<void> {
    try {
      await this.finance.restoreMovement(m.id);
      await this.refresh();
      this.toast.show(this.i18n.t('finance.movements.restored', { code: m.code }));
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }
}
