import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { kindIcon } from './finance-logic';
import { AccountKind, Summary, SummaryConfig, SummaryFreq, SummaryView } from './finance.models';
import { FinanceStore } from './finance.store';
import { SummaryBlockComponent } from './summary-block.component';
import { ExportMenuComponent } from './export-menu.component';
import { defaultConfig, periodCount, rangeOf, suggestedFreq } from './summary-logic';

const FREQS: SummaryFreq[] = ['week', 'month', 'quarter', 'year'];

/**
 * Pestaña Resumen: período (mes, año o rango) con su frecuencia, cuentas incluidas y vista
 * (todas juntas, por cuenta o ambas). Lo elegido se recuerda para cada persona.
 */
@Component({
  selector: 'oh-finance-summary',
  imports: [TPipe, SummaryBlockComponent, ExportMenuComponent],
  templateUrl: './summary.component.html',
  styleUrl: './summary.component.scss',
})
export class SummaryComponent {
  readonly familyId = input.required<string>();

  private readonly store = inject(FinanceStore);
  private readonly i18n = inject(I18n);

  protected readonly freqs = FREQS;
  protected readonly kindIcon = (k: AccountKind) => kindIcon(k);
  protected readonly config = signal<SummaryConfig | null>(null);
  protected readonly data = signal<Summary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly range = computed(() => {
    const c = this.config();
    return c ? rangeOf(c) : null;
  });
  /** Frecuencias que no superan las columnas que acepta el servidor */
  protected readonly allowedFreqs = computed(() => {
    const r = this.range();
    return r ? FREQS.filter((f) => periodCount(r.from, r.to, f) <= 120) : FREQS;
  });
  protected readonly years = computed(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, i) => now + 1 - i);
  });
  protected readonly showCombined = computed(() => this.config()?.view !== 'separate');
  protected readonly showSeparate = computed(() => this.config()?.view !== 'combined');
  protected readonly accountName = (id: string) => this.data()?.accounts.find((a) => a.id === id);

  protected readonly accountIds = computed(() => this.data()?.accounts.map((a) => a.id) ?? []);
  /** Nombre del archivo exportado: "Resumen 2026-11-01 a 2026-11-30" */
  protected readonly exportSubject = computed(() => {
    const d = this.data();
    return d ? this.i18n.t('finance.io.summarySubject', { from: d.from, to: d.to }) : '';
  });

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Al abrir (o cambiar de grupo): la última configuración de la persona
    effect(() => {
      const familyId = this.familyId();
      untracked(async () => {
        this.data.set(null);
        const saved = await this.store.summaryPrefs(familyId).catch(() => null);
        this.config.set(saved ?? defaultConfig());
      });
    });
    // Cada cambio de configuración: se recalcula y se recuerda
    effect(() => {
      const config = this.config();
      const range = this.range();
      const familyId = this.familyId();
      if (!config || !range) return;
      untracked(() => {
        void this.load(familyId, config, range);
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.store.saveSummaryPrefs(familyId, config), 600);
      });
    });
  }

  private async load(
    familyId: string,
    config: SummaryConfig,
    range: { from: string; to: string },
  ): Promise<void> {
    this.loading.set(true);
    try {
      const summary = await this.store.summary(familyId, {
        ...range,
        freq: config.freq,
        accounts: config.accounts,
      });
      if (this.config() !== config) return; // llegó una configuración más nueva
      this.data.set(summary);
      this.error.set(null);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- Controles ----------

  protected set(changes: Partial<SummaryConfig>): void {
    const current = this.config();
    if (!current) return;
    const next = { ...current, ...changes };
    // Fechas al revés: la otra fecha sigue a la que se acaba de elegir
    if (next.mode === 'range' && next.from && next.to && next.from > next.to) {
      if (changes.from) next.to = next.from;
      else next.from = next.to;
    }
    // Al cambiar el período, la frecuencia se ajusta a lo que se lee bien
    if (changes.mode || changes.from || changes.to || changes.month || changes.year) {
      const r = rangeOf(next);
      if (changes.mode || periodCount(r.from, r.to, next.freq) > 120)
        next.freq = suggestedFreq(r.from, r.to);
    }
    this.config.set(next);
  }

  protected setMode(mode: SummaryConfig['mode']): void {
    const r = this.range();
    // El rango arranca con las fechas que se estaban viendo
    this.set(mode === 'range' && r ? { mode, from: r.from, to: r.to } : { mode });
  }

  protected toggleAccount(id: string): void {
    const c = this.config();
    const d = this.data();
    if (!c || !d) return;
    // "Todas" (vacío) se vuelve la lista explícita de las incluidas
    const current = new Set(c.accounts.length ? c.accounts : d.accounts.map((a) => a.id));
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const activeIds = d.available.filter((a) => !a.archived).map((a) => a.id);
    const isAllActive = current.size === activeIds.length && activeIds.every((a) => current.has(a));
    this.set({ accounts: isAllActive ? [] : [...current] });
  }

  protected included(id: string): boolean {
    const c = this.config();
    const d = this.data();
    if (!c) return false;
    return c.accounts.length ? c.accounts.includes(id) : !!d?.accounts.some((a) => a.id === id);
  }

  protected freqLabel(f: SummaryFreq): string {
    return this.i18n.t(`finance.summary.freq.${f}`);
  }

  protected viewLabel(v: SummaryView): string {
    return this.i18n.t(`finance.summary.view.${v}`);
  }

  protected dateLabel(iso: string): string {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected money(n: number): string {
    return new Intl.NumberFormat(this.i18n.locale(), {
      style: 'currency',
      currency: this.data()?.currency ?? 'USD',
    }).format(n);
  }

  protected accountsText(): string {
    const d = this.data();
    if (!d) return '';
    if (!this.config()?.accounts.length) return this.i18n.t('finance.summary.allAccounts');
    return this.i18n.t('finance.summary.someAccounts', { n: d.accounts.length });
  }
}
