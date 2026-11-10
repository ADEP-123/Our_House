import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamiliesService } from '../families/families.service';
import { formatMoney } from '../lists/item-logic';
import { creditUsage, kindIcon } from './finance-logic';
import { Account, FamilyAccounts } from './finance.models';
import { FinanceService } from './finance.service';
import { FinanceStore } from './finance.store';
import { MovementsComponent } from './movements.component';

/**
 * Finanzas: una pestaña por cuenta, como las hojas de un Excel.
 * /finanzas?cuenta=… abre esa pestaña; con &supervision=1 un líder ve la cuenta privada de un supervisado.
 */
@Component({
  selector: 'oh-finance-page',
  imports: [RouterLink, TPipe, MovementsComponent],
  templateUrl: './finance.page.html',
  styleUrl: './finance.page.scss',
})
export class FinancePage implements OnInit {
  /** ?cuenta= pestaña abierta */
  readonly cuenta = input<string>();
  /** ?supervision=1: cuenta privada de un supervisado, en modo lectura */
  readonly supervision = input<string>();

  protected readonly families = inject(FamiliesService);
  private readonly finance = inject(FinanceService);
  private readonly store = inject(FinanceStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly kindIcon = kindIcon;
  protected readonly family = this.families.active;
  protected readonly data = signal<FamilyAccounts | null>(null);
  protected readonly archived = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Cuenta abierta en modo supervisión */
  protected readonly supervised = signal<Account | null>(null);
  private readonly nicknames = signal<Map<string, string>>(new Map());

  protected readonly selected = computed<Account | null>(() => {
    const supervised = this.supervised();
    if (supervised) return supervised;
    const accounts = this.data()?.accounts ?? [];
    return accounts.find((a) => a.id === this.cuenta()) ?? accounts[0] ?? null;
  });

  protected readonly usage = computed(() => {
    const credit = this.selected()?.credit;
    return credit ? creditUsage(credit.debt, credit.limit) : 0;
  });

  constructor() {
    effect(() => {
      const family = this.family();
      const archived = this.archived();
      untracked(() => {
        // Sin mostrar por un momento las cuentas del grupo o de la vista anterior
        this.data.set(null);
        if (family) void this.load(family.id, archived);
      });
    });
    // Nombres para mostrar quién ve y quién edita cada cuenta
    effect(() => {
      const family = this.family();
      if (!family) return;
      untracked(() =>
        this.families
          .detail(family.id)
          .then((f) => this.nicknames.set(new Map(f.members.map((m) => [m.userId, m.nickname]))))
          .catch(() => this.nicknames.set(new Map())),
      );
    });
    effect(() => {
      const id = this.cuenta();
      const supervision = this.supervision() === '1';
      untracked(() => {
        if (!supervision || !id) return this.supervised.set(null);
        void this.finance
          .account(id, true)
          .then((a) => this.supervised.set(a))
          .catch((err) => this.error.set(this.i18n.error(toApiError(err).code)));
      });
    });
  }

  /** Al terminar de enviar los cambios hechos sin conexión, saldos del servidor */
  private readonly syncedEffect = effect(() => {
    if (this.store.synced() > 0) untracked(() => void this.refreshAccounts());
  });

  async ngOnInit(): Promise<void> {
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
  }

  async load(familyId: string, archived: boolean): Promise<void> {
    try {
      this.data.set(await this.store.accounts(familyId, archived));
      this.error.set(null);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  /** Un movimiento cambió el saldo: se vuelven a pedir las cuentas sin perder la pestaña abierta */
  protected async refreshAccounts(): Promise<void> {
    const supervised = this.supervised();
    if (supervised) return this.supervised.set(await this.finance.account(supervised.id, true));
    const family = this.family();
    if (family) await this.load(family.id, this.archived());
  }

  protected money(n: number, account: Account | null = this.selected()): string {
    return formatMoney(n, account?.currency ?? this.data()?.currency ?? 'USD', this.i18n.locale());
  }

  protected kindLabel(a: Account): string {
    return this.i18n.t(`finance.kinds.${a.kind}`);
  }

  protected open(id: string): void {
    void this.router.navigate([], { queryParams: { cuenta: id }, replaceUrl: true });
  }

  /** Flechas, Inicio y Fin entre pestañas (patrón de pestañas de WAI-ARIA) */
  protected onTabKey(event: KeyboardEvent, index: number): void {
    const accounts = this.data()?.accounts ?? [];
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: accounts.length - 1,
    };
    if (!(event.key in moves) || !accounts.length) return;
    event.preventDefault();
    const next = (moves[event.key]! + accounts.length) % accounts.length;
    this.open(accounts[next]!.id);
    queueMicrotask(() => document.getElementById(`tab-${accounts[next]!.id}`)?.focus());
  }

  protected setArchivedView(value: boolean): void {
    this.archived.set(value);
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  // ---------- Quién ve y quién edita ----------

  private names(ids: string[]): string {
    const me = this.auth.user()?.id;
    return ids
      .map((id) =>
        id === me ? this.i18n.t('finance.access.you') : (this.nicknames().get(id) ?? '…'),
      )
      .join(', ');
  }

  protected owner(a: Account): string {
    if (!a.owner) return this.i18n.t('finance.leadersAdmin');
    if (a.owner.id === this.auth.user()?.id) return this.i18n.t('finance.createdByYou');
    return this.i18n.t('finance.createdBy', { name: a.owner.nickname ?? '' });
  }

  protected viewText(a: Account): string {
    if (a.viewMode === 'family') return this.i18n.t('finance.access.viewFamily');
    if (a.viewMode === 'private') return this.i18n.t('finance.access.viewPrivate');
    const ids = [...(a.owner ? [a.owner.id] : []), ...a.viewers];
    return this.i18n.t('finance.access.viewMembers', { names: this.names(ids) });
  }

  protected editText(a: Account): string {
    if (a.viewMode !== 'private' && a.editMode === 'roles' && a.editRoles.length) {
      const roles = a.editRoles.map((r) => this.i18n.t(`finance.roles.${r}`)).join(', ');
      return this.i18n.t('finance.access.editRoles', { roles });
    }
    if (a.viewMode !== 'private' && a.editMode === 'members' && a.editors.length) {
      return this.i18n.t('finance.access.editMembers', { names: this.names(a.editors) });
    }
    return this.i18n.t('finance.access.onlyAdmin');
  }

  // ---------- Acciones ----------

  async setArchived(a: Account, archived: boolean): Promise<void> {
    await this.run(async () => {
      await this.finance.setArchived(a.id, archived);
      this.toast.show(this.i18n.t(archived ? 'finance.archivedToast' : 'finance.restoredToast'));
    });
  }

  async remove(a: Account): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.deleteTitle', { name: a.name }),
      message: this.i18n.t('finance.deleteBody'),
      confirmLabel: this.i18n.t('finance.deleteConfirm'),
      cancelLabel: this.i18n.t('finance.cancel'),
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.finance.remove(a.id);
      this.toast.show(this.i18n.t('finance.deletedToast'));
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    const family = this.family();
    this.busy.set(true);
    try {
      await work();
      if (family) await this.load(family.id, this.archived());
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }

  /** Aviso de privacidad antes de abrir la cuenta privada de un supervisado */
  async openSupervised(id: string, owner: string | null): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('finance.supervised.confirmTitle'),
      message: this.i18n.t('finance.supervised.confirmBody', { name: owner ?? '' }),
      confirmLabel: this.i18n.t('finance.supervised.confirm'),
      cancelLabel: this.i18n.t('finance.cancel'),
    });
    if (ok) await this.router.navigate([], { queryParams: { cuenta: id, supervision: 1 } });
  }

  protected leaveSupervision(): void {
    void this.router.navigate([], { queryParams: {} });
  }
}
