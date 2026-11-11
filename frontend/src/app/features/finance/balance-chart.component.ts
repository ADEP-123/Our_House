import { Component, computed, input, signal } from '@angular/core';
import { niceMax, niceTicks } from './summary-logic';

export interface BalancePoint {
  label: string;
  balance: number;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 32, left: 68 };

/** Saldo al cierre de cada período: una sola línea; al pasar el mouse, cruz y detalle. */
@Component({
  selector: 'oh-balance-chart',
  template: `
    <div class="wrap" (mouseleave)="hover.set(null)">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of ticks(); track t.value) {
          <line
            class="grid"
            [class.zero]="t.value === 0"
            [attr.x1]="PAD.left"
            [attr.x2]="W - PAD.right"
            [attr.y1]="t.y"
            [attr.y2]="t.y"
          />
          <text class="axis" [attr.x]="PAD.left - 6" [attr.y]="t.y + 4" text-anchor="end">
            {{ t.text }}
          </text>
        }
        @for (p of pts(); track $index) {
          @if (p.showLabel) {
            <text class="axis" [attr.x]="p.x" [attr.y]="H - 8" text-anchor="middle">
              {{ p.label }}
            </text>
          }
        }
        <path class="line" [attr.d]="path()" />
        @if (hover() !== null && pts()[hover()!]; as p) {
          <line
            class="cross"
            [attr.x1]="p.x"
            [attr.x2]="p.x"
            [attr.y1]="PAD.top"
            [attr.y2]="H - PAD.bottom"
          />
          <circle class="dot" [attr.cx]="p.x" [attr.cy]="p.y" r="5" />
        }
        @for (p of pts(); track $index) {
          <rect
            class="hit"
            [attr.x]="p.x - step() / 2"
            [attr.y]="PAD.top"
            [attr.width]="step()"
            [attr.height]="H - PAD.top - PAD.bottom"
            (mouseenter)="hover.set($index)"
            (click)="hover.set($index)"
          />
        }
      </svg>
      @if (hover() !== null && points()[hover()!]; as p) {
        <div class="tip" [style.left.%]="tipLeft()" role="status">
          <strong>{{ p.label }}</strong>
          <span>{{ format()(p.balance) }}</span>
        </div>
      }
    </div>
  `,
  styleUrl: './chart.scss',
})
export class BalanceChartComponent {
  readonly points = input.required<BalancePoint[]>();
  readonly format = input.required<(n: number) => string>();
  readonly compact = input.required<(n: number) => string>();
  readonly ariaLabel = input('');

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly hover = signal<number | null>(null);

  /** Eje que incluye el cero si el saldo pasa por negativo */
  private readonly scale = computed(() => {
    const values = this.points().map((p) => p.balance);
    const hi = Math.max(0, ...values);
    const lo = Math.min(0, ...values);
    const top = niceMax(hi || 1);
    const bottom = lo < 0 ? -niceMax(-lo) : 0;
    return { top, bottom };
  });
  private readonly y = (v: number) => {
    const { top, bottom } = this.scale();
    return PAD.top + ((top - v) / (top - bottom || 1)) * (H - PAD.top - PAD.bottom);
  };

  protected readonly step = computed(
    () => (W - PAD.left - PAD.right) / Math.max(this.points().length, 1),
  );

  protected readonly ticks = computed(() => {
    const { top, bottom } = this.scale();
    const values = bottom < 0 ? [bottom, bottom / 2, 0, top / 2, top] : niceTicks(top);
    return [...new Set(values)].map((v) => ({ value: v, y: this.y(v), text: this.compact()(v) }));
  });

  protected readonly pts = computed(() => {
    const n = this.points().length;
    const every = Math.ceil(n / Math.floor((W - PAD.left - PAD.right) / 90));
    return this.points().map((p, i) => ({
      x: PAD.left + this.step() * i + this.step() / 2,
      y: this.y(p.balance),
      label: p.label,
      showLabel: i % every === 0,
    }));
  });

  protected readonly path = computed(() =>
    this.pts()
      .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly tipLeft = computed(() => {
    const p = this.pts()[this.hover() ?? 0];
    return p ? Math.min(80, Math.max(2, (p.x / W) * 100 - 8)) : 0;
  });
}
