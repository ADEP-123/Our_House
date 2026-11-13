import { Component, computed, inject, input } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { iconOf } from '../lists/list-presets';
import { BalanceChartComponent } from './balance-chart.component';
import { SummaryBlock, SummaryFreq } from './finance.models';
import { FlowChartComponent } from './flow-chart.component';
import { pctChange, periodLabel } from './summary-logic';

/** Categorías que se muestran con su barra; el resto se junta en "Otras" */
const TOP = 8;

/**
 * Un bloque del resumen: cifras clave con su cambio frente al período anterior,
 * entradas y salidas por período, saldo en el tiempo, gastos por categoría y la tabla categoría × período.
 * compact: para el bloque de cada cuenta (sin la línea de saldo y con la tabla plegada).
 */
@Component({
  selector: 'oh-summary-block',
  imports: [TPipe, FlowChartComponent, BalanceChartComponent],
  templateUrl: './summary-block.component.html',
  styleUrl: './summary-block.component.scss',
})
export class SummaryBlockComponent {
  readonly block = input.required<SummaryBlock>();
  readonly freq = input.required<SummaryFreq>();
  readonly currency = input.required<string>();
  readonly compact = input(false);

  private readonly i18n = inject(I18n);
  protected readonly iconOf = iconOf;

  private readonly money = computed(() => {
    const f = new Intl.NumberFormat(this.i18n.locale(), {
      style: 'currency',
      currency: this.currency(),
    });
    return (n: number) => f.format(n);
  });
  protected readonly format = computed(() => this.money());
  protected readonly compactFormat = computed(() => {
    const f = new Intl.NumberFormat(this.i18n.locale(), {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    return (n: number) => f.format(n);
  });

  protected readonly labels = computed(() => {
    const periods = this.block().periods;
    const multiYear =
      periods.length > 0 && periods[0]!.start.slice(0, 4) !== periods.at(-1)!.end.slice(0, 4);
    return periods.map((p) =>
      periodLabel(p.start, p.end, this.freq(), this.i18n.locale(), multiYear),
    );
  });

  protected readonly flowPoints = computed(() =>
    this.block().periods.map((p, i) => ({
      label: this.labels()[i]!,
      income: p.income,
      expense: p.expense,
    })),
  );
  protected readonly balancePoints = computed(() =>
    this.block().periods.map((p, i) => ({ label: this.labels()[i]!, balance: p.balance })),
  );

  protected readonly kpis = computed(() => {
    const b = this.block();
    const delta = (cur: number, prev: number) => pctChange(cur, prev);
    return [
      {
        key: 'income' as const,
        value: b.income,
        delta: delta(b.income, b.previous.income),
        prev: b.previous.income,
      },
      {
        key: 'expense' as const,
        value: b.expense,
        delta: delta(b.expense, b.previous.expense),
        prev: b.previous.expense,
      },
      {
        key: 'net' as const,
        value: b.net,
        delta: delta(b.net, b.previous.net),
        prev: b.previous.net,
      },
    ];
  });

  /** Gastos por categoría, del mayor al menor; lo que pasa de 8 va a "Otras" */
  protected readonly expenseBars = computed(() => {
    const cats = this.block().categories.filter((c) => c.expense > 0);
    const total = cats.reduce((s, c) => s + c.expense, 0) || 1;
    const top = cats.slice(0, TOP).map((c) => ({
      id: c.id,
      name: c.name ?? '—',
      icon: c.icon ? iconOf(c.icon) : '',
      value: c.expense,
    }));
    const rest = cats.slice(TOP).reduce((s, c) => s + c.expense, 0);
    if (rest > 0)
      top.push({
        id: '__other',
        name: this.i18n.t('finance.summary.otherCategories'),
        icon: '',
        value: rest,
      });
    const max = Math.max(...top.map((c) => c.value), 1);
    return top.map((c) => ({
      ...c,
      width: (c.value / max) * 100,
      share: Math.round((c.value / total) * 100),
    }));
  });

  protected readonly expenseRows = computed(() =>
    this.block().categories.filter((c) => c.expense > 0),
  );
  protected readonly incomeRows = computed(() =>
    this.block()
      .categories.filter((c) => c.income > 0)
      .sort((a, b) => b.income - a.income),
  );

  protected cell(periodIndex: number, categoryId: string, kind: 'income' | 'expense'): number {
    return this.block().periods[periodIndex]?.categories[categoryId]?.[kind] ?? 0;
  }

  protected kpiLabel(key: 'income' | 'expense' | 'net'): string {
    return this.i18n.t(`finance.summary.kpi.${key}`);
  }

  protected deltaText(d: number | null): string {
    if (d === null) return this.i18n.t('finance.summary.noPrevious');
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '=';
    return this.i18n.t('finance.summary.vsPrevious', { change: `${arrow} ${Math.abs(d)} %` });
  }
}
