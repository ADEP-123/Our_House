import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { I18n } from '../../../core/i18n/i18n.service';
import { FamiliesService } from '../../families/families.service';
import { PracticeMode } from '../../tutorial/practice-mode.service';
import { TourDefinition, TourStep, TutorialService } from '../../tutorial/tutorial.service';
import { FinancePractice } from './finance-practice';

const HOME = '/finanzas';
const isOpen = (selector: string) => !!document.querySelector(selector);
const MOVEMENT_DIALOG = 'oh-movement-dialog dialog[open]';
const TRANSFER_DIALOG = 'oh-transfer-dialog dialog[open]';
const PROJECT_DIALOG = 'oh-savings-project-dialog dialog[open]';
const MOVE_DIALOG = 'oh-savings-move-dialog dialog[open]';
const SCHEDULED_DIALOG = 'oh-scheduled-dialog dialog[open]';

/**
 * Tutorial de Finanzas: corre sobre las pantallas reales de Finanzas con datos de práctica en
 * memoria (FinancePractice), así nada llega al servidor. Lo básico (cuentas, gasto, transferencia
 * y resumen) y opcionales al final (tarjetas, presupuesto, ahorros, programados, importar y compras).
 */
@Injectable({ providedIn: 'root' })
export class FinanceTour {
  private readonly router = inject(Router);
  private readonly families = inject(FamiliesService);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  private readonly practice = inject(PracticeMode);
  private readonly tutorial = inject(TutorialService);
  private data: FinancePractice | null = null;
  /** Lo que había pasado en la práctica al empezar el paso */
  private baseline: Record<string, number> = {};
  private registered = false;

  /** Se registra una vez, desde la pantalla de Finanzas */
  register(): void {
    if (this.registered) return;
    this.registered = true;
    this.tutorial.host('finance', HOME, () => this.create());
  }

  private create(): TourDefinition {
    const user = this.auth.user()!;
    const family = this.families.active()!;
    this.data = new FinancePractice({
      id: user.id,
      nickname: user.nickname,
      familyId: family.id,
      currency: family.currency,
      locale: this.i18n.locale(),
    });
    this.baseline = {};
    this.practice.use(this.data);
    return { id: 'finance', steps: this.basic(), extras: this.extras() };
  }

  // ---------- Ayudas de los pasos ----------

  /** Pasó algo en la práctica desde que empezó el paso */
  private happened(event: string): boolean {
    return (this.data?.counts()[event] ?? 0) > (this.baseline[event] ?? 0);
  }

  /** Cada paso empieza contando desde cero y, si hace falta, en su pantalla */
  private at(url: string | null, prepare?: () => void): () => void {
    return () => {
      prepare?.();
      this.baseline = { ...(this.data?.counts() ?? {}) };
      if (url && !this.matches(url)) void this.router.navigateByUrl(url);
    };
  }

  private matches(url: string): boolean {
    const current = this.router.url;
    if (url === HOME)
      return (
        current === HOME || (current.startsWith(`${HOME}?`) && !current.includes('cuenta=resumen'))
      );
    return current.startsWith(url);
  }

  /** La cuenta del banco de la práctica (si se retoma sin haberla creado, se crea) */
  private bank(): string {
    const { id, created } = this.data!.ensureBank();
    // Solo si cambió algo: recargar la pantalla cerraría una ventana abierta
    if (created) this.practice.refresh();
    return `${HOME}?cuenta=${id}`;
  }

  /** Abre la ventana del paso si se llegó a él sin abrirla (al retomar o volver atrás) */
  private openWith(dialog: string, opener: string): void {
    // Si ya está abierta (se llegó tocando el botón), nada; si no, cuando la pantalla esté lista
    if (isOpen(dialog)) return;
    const step = this.tutorial.step();
    setTimeout(() => {
      if (isOpen(dialog) || this.tutorial.step() !== step) return;
      const button = Array.from(document.querySelectorAll<HTMLElement>(opener)).find(
        (el) => el.getClientRects().length,
      );
      button?.click();
    }, 600);
  }

  private step(s: TourStep): TourStep {
    return s;
  }

  // ---------- Lo básico ----------

  private basic(): TourStep[] {
    return [
      this.step({
        id: 'welcome',
        title: 'tutorial.finance.welcome.title',
        body: 'tutorial.finance.welcome.body',
        ensure: this.at(HOME),
      }),
      this.step({
        id: 'tabs',
        target: '[data-tour="tabs"]',
        title: 'tutorial.finance.tabs.title',
        body: 'tutorial.finance.tabs.body',
        ensure: this.at(HOME),
      }),
      this.step({
        id: 'new-account',
        target: '[data-tour="new-account"]',
        title: 'tutorial.finance.newAccount.title',
        body: 'tutorial.finance.newAccount.body',
        until: () => this.router.url.startsWith('/finanzas/cuentas/nueva'),
        ensure: this.at(HOME),
      }),
      this.step({
        id: 'account-form',
        target: '[data-tour="account-form"]',
        title: 'tutorial.finance.accountForm.title',
        body: 'tutorial.finance.accountForm.body',
        until: () => this.happened('account.created'),
        ensure: this.at(`/finanzas/cuentas/nueva?familia=${this.families.active()?.id ?? ''}`),
      }),
      this.step({
        id: 'add-movement',
        target: '[data-tour="add-movement"]',
        title: 'tutorial.finance.addMovement.title',
        body: 'tutorial.finance.addMovement.body',
        until: () => isOpen(MOVEMENT_DIALOG),
        ensure: () => this.at(this.bank())(),
      }),
      this.step({
        id: 'movement-form',
        target: MOVEMENT_DIALOG,
        title: 'tutorial.finance.movementForm.title',
        body: 'tutorial.finance.movementForm.body',
        until: () => this.happened('movement.created') && !isOpen(MOVEMENT_DIALOG),
        ensure: () => {
          this.at(this.bank())();
          this.openWith(MOVEMENT_DIALOG, '[data-tour="add-movement"]');
        },
      }),
      this.step({
        id: 'table',
        target: '[data-tour="movements-table"]',
        title: 'tutorial.finance.table.title',
        body: 'tutorial.finance.table.body',
        ensure: () => {
          const url = this.bank();
          if (this.data!.ensureExpense(new URLSearchParams(url.split('?')[1]).get('cuenta')!))
            this.practice.refresh();
          this.at(url)();
        },
      }),
      this.step({
        id: 'transfer',
        target: '[data-tour="transfer"]',
        title: 'tutorial.finance.transfer.title',
        body: 'tutorial.finance.transfer.body',
        until: () => isOpen(TRANSFER_DIALOG),
        ensure: () => this.at(this.bank())(),
      }),
      this.step({
        id: 'transfer-form',
        target: TRANSFER_DIALOG,
        title: 'tutorial.finance.transferForm.title',
        body: 'tutorial.finance.transferForm.body',
        until: () => this.happened('transfer.created') && !isOpen(TRANSFER_DIALOG),
        ensure: () => {
          this.at(this.bank())();
          this.openWith(TRANSFER_DIALOG, '[data-tour="transfer"]');
        },
      }),
      this.step({
        id: 'summary-tab',
        target: '#tab-resumen',
        title: 'tutorial.finance.summaryTab.title',
        body: 'tutorial.finance.summaryTab.body',
        until: () => this.router.url.includes('cuenta=resumen'),
        ensure: this.at(HOME),
      }),
      this.step({
        id: 'summary',
        target: 'oh-finance-summary .kpis',
        title: 'tutorial.finance.summary.title',
        body: 'tutorial.finance.summary.body',
        ensure: this.at(`${HOME}?cuenta=resumen`),
      }),
    ];
  }

  // ---------- Opcionales ----------

  /** Capítulo de tarjetas: una tarjeta de práctica con deuda, abierta en su pestaña */
  private card(): string {
    const { id, created } = this.data!.addCreditCard();
    if (created) this.practice.refresh();
    return `${HOME}?cuenta=${id}`;
  }

  private extras() {
    return [
      {
        id: 'cards',
        title: 'tutorial.finance.cards.chapter' as const,
        steps: [
          this.step({
            id: 'card',
            target: '.figure.credit',
            title: 'tutorial.finance.cards.card.title',
            body: 'tutorial.finance.cards.card.body',
            ensure: () => this.at(this.card())(),
          }),
          this.step({
            id: 'pay',
            target: '[data-tour="pay-card"]',
            title: 'tutorial.finance.cards.pay.title',
            body: 'tutorial.finance.cards.pay.body',
            until: () => isOpen(TRANSFER_DIALOG),
            ensure: () => this.at(this.card())(),
          }),
          this.step({
            id: 'pay-form',
            target: TRANSFER_DIALOG,
            title: 'tutorial.finance.cards.payForm.title',
            body: 'tutorial.finance.cards.payForm.body',
            until: () => this.happened('transfer.created.card') && !isOpen(TRANSFER_DIALOG),
            ensure: () => {
              this.at(this.card())();
              this.openWith(TRANSFER_DIALOG, '[data-tour="pay-card"]');
            },
          }),
          this.step({
            id: 'paid',
            target: '.figure.credit',
            title: 'tutorial.finance.cards.paid.title',
            body: 'tutorial.finance.cards.paid.body',
            ensure: () => this.at(this.card())(),
          }),
        ],
      },
      {
        id: 'categories',
        title: 'tutorial.finance.categories.chapter' as const,
        steps: [
          this.step({
            id: 'list',
            target: 'ul.cats',
            title: 'tutorial.finance.categories.list.title',
            body: 'tutorial.finance.categories.list.body',
            ensure: this.at('/finanzas/categorias'),
          }),
          this.step({
            id: 'edit',
            target: 'ul.cats',
            title: 'tutorial.finance.categories.edit.title',
            body: 'tutorial.finance.categories.edit.body',
            until: () => isOpen('form.editor'),
            ensure: this.at('/finanzas/categorias'),
          }),
          this.step({
            id: 'budget',
            target: 'form.editor',
            title: 'tutorial.finance.categories.budget.title',
            body: 'tutorial.finance.categories.budget.body',
            until: () => this.happened('budget.set'),
            ensure: this.at('/finanzas/categorias'),
          }),
          this.step({
            id: 'alerts',
            target: 'ul.cats',
            title: 'tutorial.finance.categories.alerts.title',
            body: 'tutorial.finance.categories.alerts.body',
            ensure: this.at('/finanzas/categorias'),
          }),
        ],
      },
      {
        id: 'savings',
        title: 'tutorial.finance.savings.chapter' as const,
        steps: [
          this.step({
            id: 'new',
            target: '[data-tour="new-project"]',
            title: 'tutorial.finance.savings.new.title',
            body: 'tutorial.finance.savings.new.body',
            until: () => isOpen(PROJECT_DIALOG),
            ensure: this.at('/finanzas/ahorros'),
          }),
          this.step({
            id: 'form',
            target: PROJECT_DIALOG,
            title: 'tutorial.finance.savings.form.title',
            body: 'tutorial.finance.savings.form.body',
            until: () => this.happened('savings.created') && !isOpen(PROJECT_DIALOG),
            ensure: this.at('/finanzas/ahorros'),
          }),
          this.step({
            id: 'set-aside',
            target: '[data-tour="set-aside"]',
            title: 'tutorial.finance.savings.setAside.title',
            body: 'tutorial.finance.savings.setAside.body',
            until: () => isOpen(MOVE_DIALOG),
            ensure: this.at('/finanzas/ahorros'),
          }),
          this.step({
            id: 'move',
            target: MOVE_DIALOG,
            title: 'tutorial.finance.savings.move.title',
            body: 'tutorial.finance.savings.move.body',
            until: () => this.happened('savings.moved') && !isOpen(MOVE_DIALOG),
            ensure: this.at('/finanzas/ahorros'),
          }),
          this.step({
            id: 'project',
            target: 'article.project',
            title: 'tutorial.finance.savings.project.title',
            body: 'tutorial.finance.savings.project.body',
            ensure: this.at('/finanzas/ahorros'),
          }),
        ],
      },
      {
        id: 'scheduled',
        title: 'tutorial.finance.scheduled.chapter' as const,
        steps: [
          this.step({
            id: 'new',
            target: '[data-tour="new-scheduled"]',
            title: 'tutorial.finance.scheduled.new.title',
            body: 'tutorial.finance.scheduled.new.body',
            until: () => isOpen(SCHEDULED_DIALOG),
            ensure: this.at('/finanzas/programados'),
          }),
          this.step({
            id: 'form',
            target: SCHEDULED_DIALOG,
            title: 'tutorial.finance.scheduled.form.title',
            body: 'tutorial.finance.scheduled.form.body',
            until: () => this.happened('scheduled.created') && !isOpen(SCHEDULED_DIALOG),
            ensure: this.at('/finanzas/programados'),
          }),
          this.step({
            id: 'item',
            target: 'li.item',
            title: 'tutorial.finance.scheduled.item.title',
            body: 'tutorial.finance.scheduled.item.body',
            ensure: this.at('/finanzas/programados'),
          }),
        ],
      },
      {
        id: 'io',
        title: 'tutorial.finance.io.chapter' as const,
        steps: [
          this.step({
            id: 'import',
            target: 'oh-finance-import-page .drop',
            title: 'tutorial.finance.io.import.title',
            body: 'tutorial.finance.io.import.body',
            ensure: this.at('/finanzas/importar'),
          }),
          this.step({
            id: 'template',
            target: 'oh-finance-import-page .head button',
            title: 'tutorial.finance.io.template.title',
            body: 'tutorial.finance.io.template.body',
            ensure: this.at('/finanzas/importar'),
          }),
          this.step({
            id: 'export',
            target: 'oh-export-menu',
            title: 'tutorial.finance.io.export.title',
            body: 'tutorial.finance.io.export.body',
            ensure: () => this.at(this.bank())(),
          }),
        ],
      },
      {
        id: 'lists',
        title: 'tutorial.finance.lists.chapter' as const,
        steps: [
          this.step({
            id: 'pay',
            title: 'tutorial.finance.lists.pay.title',
            body: 'tutorial.finance.lists.pay.body',
            ensure: this.at(null),
          }),
          this.step({
            id: 'undo',
            title: 'tutorial.finance.lists.undo.title',
            body: 'tutorial.finance.lists.undo.body',
            ensure: this.at(null),
          }),
        ],
      },
    ];
  }
}
