import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamiliesService } from '../families/families.service';
import { repeatLabel } from '../lists/due-label';
import { formatMoney } from '../lists/item-logic';
import { iconOf } from '../lists/list-presets';
import { RepeatRule } from '../lists/lists.models';
import { localToday } from './finance-logic';
import { Scheduled, ScheduledData, ScheduledPending, ScheduledSuggestion } from './finance.models';
import { FinanceStore } from './finance.store';
import { amountForInput, parseAmount } from './movement-logic';
import { ScheduledDialogComponent } from './scheduled-dialog.component';
import { scheduledSign } from './scheduled-logic';
import { ScheduledService } from './scheduled.service';
import { FinancePracticeBannerComponent } from './tutorial/finance-practice-banner.component';

/**
 * Movimientos programados del grupo: gastos, ingresos, transferencias y apartados que se repiten.
 * /finanzas/programados (?cuenta= filtra por una cuenta)
 */
@Component({
  selector: 'oh-scheduled-page',
  imports: [NgTemplateOutlet, RouterLink, TPipe, ScheduledDialogComponent, FinancePracticeBannerComponent],
  templateUrl: './scheduled.page.html',
  styleUrl: './scheduled.page.scss',
})
export class ScheduledPage implements OnInit {
  /** ?cuenta= solo los programados de esa cuenta */
  readonly cuenta = input<string>();

  protected readonly families = inject(FamiliesService);
  private readonly service = inject(ScheduledService);
  private readonly store = inject(FinanceStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  protected readonly sync = inject(SyncStatus);

  protected readonly family = this.families.active;
  protected readonly data = signal<ScheduledData | null>(null);
  protected readonly suggestions = signal<ScheduledSuggestion[]>([]);
  protected readonly hiddenSuggestions = signal<ReadonlySet<string>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Monto escrito en cada pendiente */
  protected readonly confirmText = signal<Record<string, string>>({});
  protected readonly dialog = viewChild(ScheduledDialogComponent);
  protected readonly iconOf = iconOf;

  private readonly filtered = computed(() => {
    const id = this.cuenta();
    const items = this.data()?.items ?? [];
    return id ? items.filter((s) => s.account.id === id || s.toAccount?.id === id) : items;
  });
  protected readonly filterName = computed(() => {
    const id = this.cuenta();
    return id ? (this.data()?.items.find((s) => s.account.id === id)?.account.name ?? null) : null;
  });
  protected readonly active = computed(() => this.filtered().filter((s) => !s.ended && !s.paused));
  protected readonly paused = computed(() => this.filtered().filter((s) => !s.ended && !!s.paused));
  protected readonly ended = computed(() => this.filtered().filter((s) => s.ended));
  protected readonly pending = computed(() => {
    const d = this.data();
    if (!d) return [];
    const ids = new Set(this.filtered().map((s) => s.id));
    return d.pending
      .filter((p) => ids.has(p.scheduleId))
      .map((p) => ({ ...p, schedule: d.items.find((s) => s.id === p.scheduleId)! }));
  });
  protected readonly visibleSuggestions = computed(() =>
    this.suggestions().filter((s) => !this.hiddenSuggestions().has(this.suggestionKey(s))),
  );

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
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
  }

  protected async load(): Promise<void> {
    const family = this.family();
    if (!family) return;
    try {
      const data = await this.store.scheduled(family.id);
      this.data.set(data);
      this.error.set(null);
      this.confirmText.set(
        Object.fromEntries(
          data.pending.map((p) => [
            p.id,
            p.amount ? amountForInput(p.amount, this.i18n.locale()) : '',
          ]),
        ),
      );
      this.suggestions.set(await this.service.suggestions(family.id).catch(() => []));
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  // ---------- Textos ----------

  protected money(n: number): string {
    return formatMoney(n, this.data()?.currency ?? 'USD', this.i18n.locale());
  }

  protected signedMoney(s: Scheduled): string {
    const sign = scheduledSign(s.kind);
    return `${sign > 0 ? '+' : sign < 0 ? '−' : ''}${this.money(s.amount)}`;
  }

  protected kindIcon(s: Scheduled): string {
    if (s.kind === 'transfer') return '⇄';
    if (s.kind === 'set_aside') return iconOf(s.project?.icon ?? '🎯');
    return s.category?.icon ? iconOf(s.category.icon) : '🔁';
  }

  /** "Nu", "Nu → Visa", "Nu · 🎯 Viaje" */
  protected where(s: Scheduled): string {
    if (s.kind === 'transfer')
      return `${s.account.name} → ${s.toAccount?.name ?? this.i18n.t('finance.transfers.otherAccount')}`;
    if (s.kind === 'set_aside')
      return `${s.account.name} · ${this.i18n.t('finance.scheduled.toProject', { name: s.project?.name ?? '' })}`;
    return `${s.account.name}${s.category?.name ? ` · ${s.category.name}` : ''}`;
  }

  /** "Cada mes · el día 5", "Cada semana · lun, jue" */
  protected frequency(s: Scheduled): string {
    const base = repeatLabel({ ...s.rule, from: 'schedule' } as RepeatRule, this.i18n);
    const extra =
      s.rule.freq === 'monthly'
        ? ` · ${this.i18n.t('finance.scheduled.onDay', { day: Number(s.rule.start.slice(8)) })}`
        : '';
    const end = s.rule.count
      ? ` · ${this.i18n.t('finance.scheduled.timesLeft', { done: s.timesDone, total: s.rule.count })}`
      : s.rule.until
        ? ` · ${this.i18n.t('finance.scheduled.untilDate', { date: this.dateLabel(s.rule.until) })}`
        : '';
    return base + extra + end;
  }

  protected dateLabel(iso: string): string {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected nextText(s: Scheduled): string {
    if (!s.nextDate) return '';
    const today = localToday();
    if (s.nextDate === today) return this.i18n.t('finance.scheduled.nextToday');
    return this.i18n.t('finance.scheduled.next', { date: this.dateLabel(s.nextDate) });
  }

  protected pausedText(s: Scheduled): string {
    return this.i18n.t(`finance.scheduled.pausedReason.${s.paused?.reason ?? 'manual'}`);
  }

  protected suggestionKey(s: ScheduledSuggestion): string {
    return `${s.accountId}:${s.description.toLowerCase()}`;
  }

  // ---------- Acciones ----------

  protected newScheduled(): void {
    void this.dialog()?.open(null, this.cuenta() ? { accountId: this.cuenta() } : {});
  }

  protected edit(s: Scheduled): void {
    void this.dialog()?.open(s);
  }

  protected fromSuggestion(s: ScheduledSuggestion): void {
    void this.dialog()?.open(null, {
      accountId: s.accountId,
      description: s.description,
      categoryId: s.categoryId,
      amount: s.amount,
      day: s.day,
    });
  }

  protected hideSuggestion(s: ScheduledSuggestion): void {
    this.hiddenSuggestions.update((set) => new Set([...set, this.suggestionKey(s)]));
  }

  protected clearFilter(): void {
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  protected action(s: Scheduled, action: 'pause' | 'resume' | 'skip'): Promise<void> {
    return this.run(async () => {
      await this.service.action(s.id, action);
      if (action === 'skip')
        this.toast.show(this.i18n.t('finance.scheduled.skipped', { what: s.description }));
    });
  }

  protected async remove(s: Scheduled): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.scheduled.deleteTitle', { what: s.description }),
      message: this.i18n.t('finance.scheduled.deleteBody'),
      confirmLabel: this.i18n.t('finance.scheduled.delete'),
      cancelLabel: this.i18n.t('finance.cancel'),
      danger: true,
    });
    if (ok) await this.run(() => this.service.remove(s.id));
  }

  protected setConfirmText(id: string, value: string): void {
    this.confirmText.update((t) => ({ ...t, [id]: value }));
  }

  protected confirmAmount(p: ScheduledPending): number | null {
    const amount = parseAmount(this.confirmText()[p.id] ?? '', this.i18n.locale());
    return amount !== null && amount > 0 ? amount : null;
  }

  protected confirmPending(p: ScheduledPending): Promise<void> {
    const amount = this.confirmAmount(p);
    if (amount === null) return Promise.resolve();
    return this.run(async () => {
      await this.service.confirm(p.id, amount);
      this.toast.show(this.i18n.t('finance.scheduled.confirmed', { amount: this.money(amount) }));
    });
  }

  protected dismissPending(p: ScheduledPending): Promise<void> {
    return this.run(() => this.service.dismiss(p.id));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.load();
    } catch (err) {
      this.toast.show(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
