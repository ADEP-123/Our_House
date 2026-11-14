import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamiliesService } from '../families/families.service';
import { IconPickerComponent } from '../lists/icon-picker.component';
import { formatMoney } from '../lists/item-logic';
import { LIST_COLORS, colorOf, iconOf } from '../lists/list-presets';
import { buildOverrides } from './finance-logic';
import { signOf } from './movement-logic';
import {
  Budget,
  Category,
  CategoryInput,
  CategoryMovement,
  FamilyCategories,
} from './finance.models';
import { FinanceService } from './finance.service';
import { FinanceStore } from './finance.store';
import { SavingsService } from './savings.service';
import { amountForInput, parseAmount } from './movement-logic';
import { FinancePracticeBannerComponent } from './tutorial/finance-practice-banner.component';

interface Removal {
  category: Category;
  movements: CategoryMovement[];
  hiddenCount: number;
  moveTo: string;
  /** movimiento → categoría elegida ('' = la misma que el resto) */
  overrides: Record<string, string>;
}

/**
 * Categorías de los movimientos del grupo. Todos las ven; solo los líderes las cambian.
 * /finanzas/categorias
 */
@Component({
  selector: 'oh-categories-page',
  imports: [NgTemplateOutlet, RouterLink, TPipe, IconPickerComponent, FinancePracticeBannerComponent],
  templateUrl: './categories.page.html',
  styleUrl: './categories.page.scss',
})
export class CategoriesPage implements OnInit {
  protected readonly families = inject(FamiliesService);
  private readonly finance = inject(FinanceService);
  private readonly store = inject(FinanceStore);
  private readonly savings = inject(SavingsService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly colors = Object.entries(LIST_COLORS);
  protected readonly colorOf = colorOf;
  protected readonly iconOf = iconOf;
  protected readonly family = this.families.active;
  protected readonly data = signal<FamilyCategories | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** Categoría en edición: su id, 'new' para crear, o null */
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<CategoryInput>({ name: '', icon: '📦', color: 'gray' });
  protected readonly formError = signal<string | null>(null);
  protected readonly removal = signal<Removal | null>(null);
  /** Presupuesto mensual de cada categoría con lo gastado este mes */
  protected readonly budgets = signal<Budget[]>([]);
  protected readonly budgetText = signal('');

  protected readonly active = computed(() =>
    (this.data()?.categories ?? []).filter((c) => !c.disabled),
  );
  protected readonly disabled = computed(() =>
    (this.data()?.categories ?? []).filter((c) => c.disabled),
  );
  /** Destinos posibles al borrar: todas menos la que se borra (las habilitadas primero) */
  protected readonly targets = computed(() => {
    const removing = this.removal()?.category.id;
    return [...this.active(), ...this.disabled()].filter((c) => c.id !== removing);
  });

  constructor() {
    effect(() => {
      const family = this.family();
      untracked(() => {
        this.data.set(null);
        this.editing.set(null);
        this.removal.set(null);
        if (family) void this.load(family.id);
      });
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
  }

  private async load(familyId: string): Promise<void> {
    try {
      this.data.set(await this.finance.categories(familyId));
      this.error.set(null);
      this.budgets.set((await this.store.budgets(familyId).catch(() => null))?.budgets ?? []);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected budgetOf(id: string): Budget | undefined {
    return this.budgets().find((b) => b.categoryId === id);
  }

  /** "Presupuesto 1.000 al mes · llevas 850 (85 %)" */
  protected budgetText_(b: Budget): string {
    const currency = this.family()?.currency ?? 'USD';
    return this.i18n.t('finance.budget.line', {
      limit: formatMoney(b.limit, currency, this.i18n.locale()),
      spent: formatMoney(b.spent, currency, this.i18n.locale()),
      pct: b.pct,
    });
  }

  protected usage(c: Category): string {
    return c.usage === 1
      ? this.i18n.t('finance.categories.oneMovement')
      : this.i18n.t('finance.categories.movements', { n: c.usage });
  }

  protected money(m: CategoryMovement): string {
    const currency = this.family()?.currency ?? 'USD';
    const signed = signOf(m.kind, m.amount);
    return formatMoney(signed, currency, this.i18n.locale());
  }

  protected date(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  // ---------- Crear y editar ----------

  startNew(): void {
    this.removal.set(null);
    this.formError.set(null);
    this.draft.set({ name: '', icon: '📦', color: 'gray' });
    this.budgetText.set('');
    this.editing.set('new');
  }

  startEdit(c: Category): void {
    this.removal.set(null);
    this.formError.set(null);
    this.draft.set({ name: c.name, icon: c.icon, color: c.color });
    const budget = this.budgetOf(c.id);
    this.budgetText.set(budget ? amountForInput(budget.limit, this.i18n.locale()) : '');
    this.editing.set(c.id);
  }

  protected setDraft(changes: Partial<CategoryInput>): void {
    this.draft.update((d) => ({ ...d, ...changes }));
  }

  async save(): Promise<void> {
    const family = this.family();
    const editing = this.editing();
    const draft = { ...this.draft(), name: this.draft().name.trim() };
    if (!family || !editing || !draft.name) return;
    const budgetText = this.budgetText().trim();
    const budget = budgetText ? parseAmount(budgetText, this.i18n.locale()) : null;
    if (budgetText && (budget === null || budget <= 0)) {
      this.formError.set(this.i18n.error('BUDGET_AMOUNT_INVALID'));
      return;
    }
    this.busy.set(true);
    this.formError.set(null);
    try {
      const id =
        editing === 'new'
          ? (await this.finance.createCategory(family.id, draft)).id
          : (await this.finance.updateCategory(editing, draft)).id;
      // Presupuesto: solo si cambió
      if ((this.budgetOf(id)?.limit ?? null) !== budget) await this.savings.setBudget(id, budget);
      this.editing.set(null);
      await this.load(family.id);
    } catch (err) {
      const e = toApiError(err);
      this.formError.set(
        this.i18n.error(e.code === 'VALIDATION' ? Object.values(e.fields)[0] : e.code),
      );
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Deshabilitar ----------

  async setDisabled(c: Category, disabled: boolean): Promise<void> {
    await this.run(async () => {
      await this.finance.updateCategory(c.id, { disabled });
      this.toast.show(
        this.i18n.t(
          disabled ? 'finance.categories.disabledToast' : 'finance.categories.enabledToast',
          { name: c.name },
        ),
      );
    });
  }

  // ---------- Borrar ----------

  async startRemove(c: Category): Promise<void> {
    this.editing.set(null);
    if (c.usage === 0) {
      const ok = await this.confirm.ask({
        title: this.i18n.t('finance.categories.deleteTitle', { name: c.name }),
        message: this.i18n.t('finance.categories.deleteEmpty'),
        confirmLabel: this.i18n.t('finance.categories.deleteConfirm'),
        cancelLabel: this.i18n.t('finance.cancel'),
        danger: true,
      });
      if (ok) await this.remove(c, null, []);
      return;
    }
    try {
      const { movements, hiddenCount } = await this.finance.categoryMovements(c.id);
      const first =
        this.targets().find((t) => t.id !== c.id && !t.disabled) ??
        this.targets().find((t) => t.id !== c.id);
      this.removal.set({
        category: c,
        movements,
        hiddenCount,
        moveTo: first?.id ?? '',
        overrides: {},
      });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected setMoveTo(id: string): void {
    this.removal.update((r) => (r ? { ...r, moveTo: id } : r));
  }

  protected setOverride(movementId: string, categoryId: string): void {
    this.removal.update((r) =>
      r ? { ...r, overrides: { ...r.overrides, [movementId]: categoryId } } : r,
    );
  }

  async confirmRemove(): Promise<void> {
    const r = this.removal();
    if (!r?.moveTo) return;
    await this.remove(r.category, r.moveTo, buildOverrides(r.overrides, r.moveTo));
  }

  private async remove(
    c: Category,
    moveTo: string | null,
    overrides: { movementId: string; categoryId: string }[],
  ): Promise<void> {
    await this.run(async () => {
      await this.finance.deleteCategory(c.id, moveTo, overrides);
      this.removal.set(null);
      this.toast.show(this.i18n.t('finance.categories.deletedToast', { name: c.name }));
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    const family = this.family();
    this.busy.set(true);
    try {
      await work();
      if (family) await this.load(family.id);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
