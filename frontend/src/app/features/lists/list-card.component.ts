import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { formatMoney } from './item-logic';
import { colorOf, iconOf, LIST_TYPES } from './list-presets';
import { ListSummary } from './lists.models';

/** Tarjeta con el resumen: hechas, pendientes y total, y una barra de progreso en el color de la lista. */
@Component({
  selector: 'oh-list-card',
  imports: [RouterLink, TPipe],
  template: `
    @let l = list();
    <a class="card" [routerLink]="['/listas', l.id]" [style.--list-color]="color()">
      <div class="top">
        <span class="icon" aria-hidden="true">{{ icon() }}</span>
        <div class="title">
          <p class="name">{{ l.name }}</p>
          <p class="meta">
            {{ typeLabel() | t }}
            @if (l.createdBy?.nickname; as nick) {
              · {{ 'lists.by' | t: { name: nick } }}
            }
          </p>
        </div>
        <span class="badges">
          @if (l.pinned) {
            <span class="badge" [title]="'lists.pinned' | t">📌<span class="oh-sr-only">{{ 'lists.pinned' | t }}</span></span>
          }
          @if (l.isPrivate) {
            <span class="badge" [title]="'lists.private' | t">🔒<span class="oh-sr-only">{{ 'lists.private' | t }}</span></span>
          }
        </span>
      </div>

      <div class="progress" role="progressbar" [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'lists.summary' | t: { done: l.counts.completed, total: l.counts.total }">
        <span [style.width.%]="percent()"></span>
      </div>

      <dl class="counts">
        <div><dt>{{ 'lists.counts.completed' | t }}</dt><dd>{{ l.counts.completed }}</dd></div>
        <div><dt>{{ 'lists.counts.pending' | t }}</dt><dd>{{ l.counts.pending }}</dd></div>
        <div><dt>{{ 'lists.counts.total' | t }}</dt><dd>{{ l.counts.total }}</dd></div>
      </dl>

      @if (l.spent) {
        <p class="spent">{{ 'lists.purchase.spentTotal' | t: { spent: spent() } }}</p>
      }

      @if (l.purgeAt) {
        <p class="purge">{{ 'lists.purgesOn' | t: { date: purgeDate() } }}</p>
      }
    </a>
  `,
  styles: `
    .spent {
      font-size: 0.875rem;
      font-weight: 600;
    }
    .card {
      display: grid;
      gap: 14px;
      height: 100%;
      padding: 18px;
      border-radius: var(--oh-radius-lg);
      border: 1px solid var(--oh-border);
      background: var(--oh-surface);
      color: var(--oh-text);
      text-decoration: none;
      transition: border-color 120ms ease;
    }
    .card:hover {
      border-color: color-mix(in srgb, var(--list-color) 55%, var(--oh-border));
    }
    .top {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      align-items: center;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 14px;
      font-size: 1.35rem;
      background: color-mix(in srgb, var(--list-color) 18%, var(--oh-surface));
    }
    .title {
      min-width: 0;
    }
    .name {
      font-weight: 700;
      font-size: 1.0625rem;
      overflow-wrap: anywhere;
    }
    .meta {
      font-size: 0.8125rem;
      color: var(--oh-text-muted);
    }
    .badges {
      display: flex;
      gap: 2px;
      align-self: start;
      font-size: 0.875rem;
    }
    .progress {
      height: 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--list-color) 14%, var(--oh-surface));
      overflow: hidden;
    }
    .progress span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--list-color);
    }
    .counts {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      margin: 0;
    }
    .counts div {
      display: grid;
    }
    dt {
      font-size: 0.75rem;
      color: var(--oh-text-muted);
    }
    dd {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .purge {
      font-size: 0.8125rem;
      color: var(--oh-error);
    }
  `,
})
export class ListCardComponent {
  private readonly i18n = inject(I18n);
  readonly list = input.required<ListSummary>();
  protected readonly color = computed(() => colorOf(this.list().color));
  protected readonly icon = computed(() => iconOf(this.list().icon));
  protected readonly typeLabel = computed(() => LIST_TYPES.find((t) => t.id === this.list().type)!.label);
  protected readonly percent = computed(() => {
    const { total, completed } = this.list().counts;
    return total ? Math.round((completed / total) * 100) : 0;
  });
  protected readonly spent = computed(() => formatMoney(this.list().spent ?? 0, this.list().currency, this.i18n.locale()));
  protected readonly purgeDate = computed(() =>
    new Date(this.list().purgeAt!).toLocaleDateString(this.i18n.locale(), { day: 'numeric', month: 'long' }),
  );
}
