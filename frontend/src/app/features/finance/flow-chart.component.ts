import { Component, computed, input, signal } from '@angular/core';
import { niceMax, niceTicks } from './summary-logic';

export interface FlowPoint {
  label: string;
  income: number;
  expense: number;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 32, left: 68 };

/**
 * Entradas y salidas por período: columnas agrupadas sobre un mismo eje.
 * Dos series con leyenda; al pasar el mouse (o tocar) se ve el detalle del período.
 */
@Component({
  selector: 'oh-flow-chart',
  template: `
    <div class="legend" aria-hidden="true">
      <span><i class="sw income"></i>{{ incomeLabel() }}</span>
      <span><i class="sw expense"></i>{{ expenseLabel() }}</span>
    </div>
    <div class="wrap" (mouseleave)="hover.set(null)">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of ticks(); track t.value) {
          <line
            class="grid"
            [attr.x1]="PAD.left"
            [attr.x2]="W - PAD.right"
            [attr.y1]="t.y"
            [attr.y2]="t.y"
          />
          <text class="axis" [attr.x]="PAD.left - 6" [attr.y]="t.y + 4" text-anchor="end">
            {{ t.text }}
          </text>
        }
        @for (b of bars(); track $index) {
          @if (b.income.h > 0) {
            <path class="income" [attr.d]="b.income.d" />
          }
          @if (b.expense.h > 0) {
            <path class="expense" [attr.d]="b.expense.d" />
          }
          @if (b.showLabel) {
            <text class="axis" [attr.x]="b.cx" [attr.y]="H - 8" text-anchor="middle">
              {{ b.label }}
            </text>
          }
          <!-- Zona de toque más grande que las barras -->
          <rect
            class="hit"
            [attr.x]="b.x"
            [attr.y]="PAD.top"
            [attr.width]="b.w"
            [attr.height]="H - PAD.top - PAD.bottom"
            (mouseenter)="hover.set($index)"
            (click)="hover.set($index)"
          />
        }
        <line
          class="base"
          [attr.x1]="PAD.left"
          [attr.x2]="W - PAD.right"
          [attr.y1]="H - PAD.bottom"
          [attr.y2]="H - PAD.bottom"
        />
      </svg>
      @if (hover() !== null && points()[hover()!]; as p) {
        <div class="tip" [style.left.%]="tipLeft()" role="status">
          <strong>{{ p.label }}</strong>
          <span><i class="sw income"></i>{{ incomeLabel() }}: {{ format()(p.income) }}</span>
          <span><i class="sw expense"></i>{{ expenseLabel() }}: {{ format()(p.expense) }}</span>
          <span>{{ netLabel() }}: {{ format()(p.income - p.expense) }}</span>
        </div>
      }
    </div>
  `,
  styleUrl: './chart.scss',
})
export class FlowChartComponent {
  readonly points = input.required<FlowPoint[]>();
  readonly format = input.required<(n: number) => string>();
  readonly compact = input.required<(n: number) => string>();
  readonly incomeLabel = input.required<string>();
  readonly expenseLabel = input.required<string>();
  readonly netLabel = input.required<string>();
  readonly ariaLabel = input('');

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly hover = signal<number | null>(null);

  private readonly max = computed(() =>
    niceMax(Math.max(0, ...this.points().flatMap((p) => [p.income, p.expense]))),
  );
  private readonly y = (v: number) =>
    H - PAD.bottom - (v / this.max()) * (H - PAD.top - PAD.bottom);

  protected readonly ticks = computed(() =>
    niceTicks(this.max()).map((v) => ({ value: v, y: this.y(v), text: this.compact()(v) })),
  );

  protected readonly bars = computed(() => {
    const pts = this.points();
    const n = Math.max(pts.length, 1);
    const gw = (W - PAD.left - PAD.right) / n;
    const bw = Math.max(2, Math.min(18, (gw - 8) / 2 - 1));
    // Una etiqueta cada tantas columnas para que no se monten
    const every = Math.ceil(n / Math.floor((W - PAD.left - PAD.right) / 90));
    const bar = (x: number, v: number) => {
      const top = this.y(v);
      const h = H - PAD.bottom - top;
      const r = Math.min(4, h, bw / 2);
      // Extremo de datos redondeado (4px); la base queda recta sobre el eje
      const d = `M${x},${H - PAD.bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - PAD.bottom} Z`;
      return { h, d };
    };
    return pts.map((p, i) => {
      const x = PAD.left + i * gw;
      const cx = x + gw / 2;
      return {
        x,
        w: gw,
        cx,
        label: p.label,
        showLabel: i % every === 0,
        income: bar(cx - bw - 1, p.income),
        expense: bar(cx + 1, p.expense),
      };
    });
  });

  protected readonly tipLeft = computed(() => {
    const i = this.hover() ?? 0;
    const b = this.bars()[i];
    if (!b) return 0;
    return Math.min(78, Math.max(2, (b.cx / W) * 100 - 10));
  });
}
