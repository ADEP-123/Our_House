import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamiliesService } from '../families/families.service';
import { formatMoney } from '../lists/item-logic';
import { BalanceChartComponent, BalancePoint } from './balance-chart.component';
import { DebtDialogComponent, DebtEntryDialogComponent } from './debt-dialogs.component';
import { daysUntil, debtProgress, sortDebts } from './debt-logic';
import { DebtsService } from './debts.service';
import {
  Account,
  Category,
  Debt,
  DebtDirection,
  DebtHistoryEntry,
  DebtsData,
} from './finance.models';
import { FinanceStore } from './finance.store';

/**
 * Deudas del grupo: "Debo" y "Me deben", con abonos, cambios de monto e historial. Las tarjetas
 * de crédito aparecen en "Debo" con su deuda de cada mes (solo lectura). /finanzas/deudas
 */
@Component({
  selector: 'oh-debts-page',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TPipe,
    BalanceChartComponent,
    DebtDialogComponent,
    DebtEntryDialogComponent,
  ],
  templateUrl: './debts.page.html',
  styleUrls: ['./debts.page.scss', './debt-cards.scss'],
})
export class DebtsPage implements OnInit {
  protected readonly families = inject(FamiliesService);
  private readonly debtsApi = inject(DebtsService);
  private readonly store = inject(FinanceStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly route = inject(ActivatedRoute);
  protected readonly sync = inject(SyncStatus);

  protected readonly family = this.families.active;
  protected readonly data = signal<DebtsData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<DebtDirection>('owe');
  protected readonly history = signal<Record<string, DebtHistoryEntry[]>>({});
  protected readonly showPaid = signal(false);
  protected readonly members = signal<{ userId: string; nickname: string }[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  /** Deuda resaltada (viene del enlace del correo) */
  protected readonly highlight = signal<string | null>(null);

  protected readonly debtDialog = viewChild.required(DebtDialogComponent);
  protected readonly entryDialog = viewChild.required(DebtEntryDialogComponent);

  protected readonly list = computed(() =>
    sortDebts((this.data()?.debts ?? []).filter((d) => d.direction === this.tab())),
  );
  protected readonly total = computed(() => {
    const t = this.data()?.totals;
    if (!t) return 0;
    return this.tab() === 'owe' ? t.owe + t.cards : t.owed;
  });
  protected readonly cardsWithDebt = computed(() =>
    (this.data()?.cards ?? []).filter((c) => c.debt > 0 || c.months.some((m) => m.debt > 0)),
  );
  protected readonly points = computed<BalancePoint[]>(() =>
    (this.data()?.timeline ?? []).map((t) => ({
      label: this.monthLabel(t.month),
      balance: this.tab() === 'owe' ? t.owe : t.owed,
    })),
  );
  protected readonly format = (n: number) => this.money(n);
  protected readonly compact = (n: number) =>
    new Intl.NumberFormat(this.i18n.locale(), {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);

  constructor() {
    effect(() => {
      const family = this.family();
      untracked(() => {
        this.data.set(null);
        if (family) void this.load();
      });
    });
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.queryParamMap.get('deuda');
    if (id) this.highlight.set(id);
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
  }

  protected async load(): Promise<void> {
    const family = this.family();
    if (!family) return;
    try {
      const data = await this.debtsApi.list(family.id);
      this.data.set(data);
      this.error.set(null);
      // Desde el correo: abre la pestaña de esa deuda
      const target = data.debts.find((d) => d.id === this.highlight());
      if (target) {
        this.tab.set(target.direction);
        setTimeout(() =>
          document.getElementById(`debt-${target.id}`)?.scrollIntoView({ block: 'center' }),
        );
      }
      for (const id of Object.keys(this.history())) void this.loadHistory(id);
      void this.loadExtras(family.id);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  /** Personas (para "Personas elegidas"), cuentas donde registrar abonos y categorías */
  private async loadExtras(familyId: string): Promise<void> {
    const [detail, accounts, categories] = await Promise.all([
      this.families.detail(familyId).catch(() => null),
      this.store.accounts(familyId).catch(() => null),
      this.store.categories(familyId).catch(() => null),
    ]);
    this.members.set(
      (detail?.members ?? []).map((m) => ({ userId: m.userId, nickname: m.nickname })),
    );
    this.accounts.set(
      (accounts?.accounts ?? []).filter((a) => a.permissions.canEdit && !a.archivedAt),
    );
    // Una categoría de deudas o préstamos primero, si existe
    const usable = (categories?.categories ?? []).filter((c) => !c.disabled);
    const match = usable.findIndex((c) => /deud|préstam|prestam|debt|loan/i.test(c.name));
    this.categories.set(
      match > 0 ? [usable[match]!, ...usable.filter((_, i) => i !== match)] : usable,
    );
  }

  protected money(n: number): string {
    return formatMoney(n, this.data()?.currency ?? 'USD', this.i18n.locale());
  }

  protected progress(d: Debt): number {
    return debtProgress(d);
  }

  protected dateLabel(iso: string): string {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected monthLabel(month: string): string {
    return new Date(`${month}-15T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      month: 'short',
      year: '2-digit',
    });
  }

  /** "Vence el 1 dic 2026 · en 14 días" o "vencida hace 3 días" */
  protected dueText(d: Debt): string {
    if (!d.dueDate) return '';
    const n = daysUntil(d.dueDate, this.data()!.today);
    const base = this.i18n.t('finance.debts.dueOn', { date: this.dateLabel(d.dueDate) });
    if (d.balance <= 0) return base;
    if (n < 0) return `${base} · ${this.i18n.t('finance.debts.overdue', { n: -n })}`;
    if (n === 0) return `${base} · ${this.i18n.t('finance.debts.dueToday')}`;
    if (n === 1) return `${base} · ${this.i18n.t('finance.debts.dueTomorrow')}`;
    return `${base} · ${this.i18n.t('finance.debts.dueIn', { n })}`;
  }

  protected dueSoon(d: Debt): boolean {
    return !!d.dueDate && d.balance > 0 && daysUntil(d.dueDate, this.data()!.today) <= 3;
  }

  // ---------- Acciones ----------

  protected newDebt(): void {
    this.debtDialog().open(null, this.tab());
  }

  protected edit(d: Debt): void {
    this.debtDialog().open(d);
  }

  protected pay(d: Debt): void {
    this.entryDialog().open(d, 'payment');
  }

  protected change(d: Debt): void {
    this.entryDialog().open(d, 'change');
  }

  protected async remove(d: Debt): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.debts.delete'),
      message: this.i18n.t('finance.debts.deleteConfirm', { title: d.title }),
      confirmLabel: this.i18n.t('finance.debts.delete'),
      cancelLabel: this.i18n.t('finance.debts.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.debtsApi.remove(d.id);
      this.toast.show(this.i18n.t('finance.debts.deleted'));
      await this.load();
    } catch (err) {
      this.toast.show(this.i18n.error(toApiError(err).code));
    }
  }

  protected async toggleHistory(d: Debt): Promise<void> {
    if (this.history()[d.id]) {
      const { [d.id]: _, ...rest } = this.history();
      this.history.set(rest);
      return;
    }
    await this.loadHistory(d.id);
  }

  private async loadHistory(id: string): Promise<void> {
    try {
      const entries = await this.debtsApi.history(id);
      this.history.update((h) => ({ ...h, [id]: entries }));
    } catch {
      this.history.update(({ [id]: _, ...rest }) => rest);
    }
  }

  protected async removeEntry(d: Debt, e: DebtHistoryEntry): Promise<void> {
    const message = e.movement
      ? this.i18n.t('finance.debts.removeEntryMovement', { account: e.movement.accountName ?? '' })
      : this.i18n.t('finance.debts.removeEntryConfirm');
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.debts.removeEntry'),
      message,
      confirmLabel: this.i18n.t('finance.debts.removeEntry'),
      cancelLabel: this.i18n.t('finance.debts.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.debtsApi.removeEntry(e.id);
      await this.load();
    } catch (err) {
      this.toast.show(this.i18n.error(toApiError(err).code));
    }
  }

  protected async saved(
    message: 'finance.debts.saved' | 'finance.debts.registered',
  ): Promise<void> {
    this.toast.show(this.i18n.t(message));
    await this.load();
  }

  protected entryLabel(e: DebtHistoryEntry): string {
    if (e.kind === 'created')
      return this.i18n.t('finance.debts.hCreated', { amount: this.money(e.amount) });
    const label = {
      payment: 'finance.debts.hPayment',
      increase: 'finance.debts.hIncrease',
      decrease: 'finance.debts.hDecrease',
    } as const;
    return this.i18n.t(label[e.kind]);
  }

  protected entrySign(e: DebtHistoryEntry): string {
    return e.kind === 'increase' ? '+' : e.kind === 'created' ? '' : '−';
  }
}
