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
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamiliesService } from '../families/families.service';
import { formatMoney } from '../lists/item-logic';
import { iconOf } from '../lists/list-presets';
import { kindIcon, localToday } from './finance-logic';
import { SavingsData, SavingsHistoryEntry, SavingsProject } from './finance.models';
import {
  SavingsMoveDialogComponent,
  SavingsProjectDialogComponent,
} from './savings-dialogs.component';
import { goalProgress, monthlyToGoal } from './savings-logic';
import { SavingsService } from './savings.service';
import { FinancePracticeBannerComponent } from './tutorial/finance-practice-banner.component';

/**
 * Proyectos de ahorro del grupo: el dinero se aparta dentro de una cuenta (el saldo no cambia, el disponible sí).
 * /finanzas/ahorros
 */
@Component({
  selector: 'oh-savings-page',
  imports: [RouterLink, TPipe, SavingsProjectDialogComponent, SavingsMoveDialogComponent, FinancePracticeBannerComponent],
  templateUrl: './savings.page.html',
  styleUrl: './savings.page.scss',
})
export class SavingsPage implements OnInit {
  protected readonly families = inject(FamiliesService);
  private readonly savings = inject(SavingsService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  protected readonly sync = inject(SyncStatus);

  protected readonly family = this.families.active;
  protected readonly data = signal<SavingsData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly history = signal<Record<string, SavingsHistoryEntry[]>>({});
  protected readonly iconOf = iconOf;
  protected readonly kindIcon = kindIcon;
  protected readonly projectDialog = viewChild.required(SavingsProjectDialogComponent);
  protected readonly moveDialog = viewChild(SavingsMoveDialogComponent);

  protected readonly open = computed(() =>
    (this.data()?.projects ?? []).filter((p) => !p.closedAt),
  );
  protected readonly closed = computed(() =>
    (this.data()?.projects ?? []).filter((p) => !!p.closedAt),
  );
  protected readonly totalSaved = computed(() => this.open().reduce((s, p) => s + p.saved, 0));
  protected readonly canSetAside = computed(() =>
    (this.data()?.accounts ?? []).some((a) => a.canEdit),
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
      this.data.set(await this.savings.list(family.id));
      this.error.set(null);
      // El historial abierto se vuelve a pedir para que no quede viejo
      for (const id of Object.keys(this.history())) void this.loadHistory(id);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected money(n: number): string {
    return formatMoney(n, this.data()?.currency ?? 'USD', this.i18n.locale());
  }

  protected progress(p: SavingsProject): number {
    return goalProgress(p.saved, p.goal);
  }

  protected perMonth(p: SavingsProject): number | null {
    return monthlyToGoal(p.saved, p.goal, p.targetDate, localToday());
  }

  protected dateLabel(iso: string): string {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  // ---------- Acciones ----------

  protected newProject(): void {
    this.projectDialog().open(null);
  }

  protected edit(p: SavingsProject): void {
    this.projectDialog().open(p);
  }

  protected moveMoney(p: SavingsProject, action: 'set_aside' | 'release'): void {
    this.moveDialog()?.open(p, action);
  }

  protected async close(p: SavingsProject): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.savings.closeTitle', { name: p.name }),
      message: this.i18n.t('finance.savings.closeBody', { amount: this.money(p.saved) }),
      confirmLabel: this.i18n.t('finance.savings.close'),
      cancelLabel: this.i18n.t('finance.cancel'),
    });
    if (!ok) return;
    await this.run(() => this.savings.close(p.id));
  }

  protected reopen(p: SavingsProject): Promise<void> {
    return this.run(() => this.savings.reopen(p.id));
  }

  protected async remove(p: SavingsProject): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.savings.deleteTitle', { name: p.name }),
      message: this.i18n.t('finance.savings.deleteBody'),
      confirmLabel: this.i18n.t('finance.savings.delete'),
      cancelLabel: this.i18n.t('finance.cancel'),
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.savings.remove(p.id));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await this.load();
    } catch (err) {
      this.toast.show(this.i18n.error(toApiError(err).code));
    }
  }

  // ---------- Historial ----------

  protected onHistoryToggle(p: SavingsProject, event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.history()[p.id])
      void this.loadHistory(p.id);
  }

  private async loadHistory(id: string): Promise<void> {
    try {
      const list = await this.savings.history(id);
      this.history.update((h) => ({ ...h, [id]: list }));
    } catch {
      // Sin conexión: queda lo que había
    }
  }

  protected historyText(h: SavingsHistoryEntry): string {
    const who = h.actor?.nickname ?? '—';
    const where = h.account?.name ?? this.i18n.t('finance.savings.otherAccount');
    if (h.kind === 'spend')
      return this.i18n.t('finance.savings.history.spend', {
        who,
        where,
        what: h.description ?? '—',
      });
    return this.i18n.t(
      h.kind === 'set_aside'
        ? 'finance.savings.history.setAside'
        : 'finance.savings.history.release',
      { who, where },
    );
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}
