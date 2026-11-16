import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ToastService } from '../../shared/toast.service';
import { FinanceIoService } from './finance-io.service';
import { Summary } from './finance.models';

type Scope = 'this' | 'all' | 'pick';

/**
 * Botón "Exportar" con Excel o CSV.
 * - En la hoja de una cuenta (con `choices`): esta cuenta, todas o las que se elijan, y todo o
 *   entre fechas, en un solo archivo.
 * - En el resumen: lo que muestra el resumen; el Excel lleva además la hoja categoría × período.
 * En el celular el menú se abre como hoja desde abajo.
 */
@Component({
  selector: 'oh-export-menu',
  imports: [TPipe],
  template: `
    <details class="menu-wrap" #details>
      <summary class="oh-btn oh-btn--text" [attr.aria-busy]="busy()">
        {{ (busy() ? 'finance.io.exporting' : 'finance.io.export') | t }}
      </summary>
      <div class="menu" role="group" [attr.aria-label]="'finance.io.export' | t">
        @if (choices(); as list) {
          <fieldset>
            <legend>{{ 'finance.io.scopeTitle' | t }}</legend>
            <label class="opt">
              <input
                type="radio"
                name="scope"
                [checked]="scope() === 'this'"
                (change)="scope.set('this')"
              />
              {{ 'finance.io.scopeThis' | t: { name: currentName() } }}
            </label>
            <label class="opt">
              <input
                type="radio"
                name="scope"
                [checked]="scope() === 'all'"
                (change)="scope.set('all')"
              />
              {{ 'finance.io.scopeAll' | t }}
            </label>
            <label class="opt">
              <input
                type="radio"
                name="scope"
                [checked]="scope() === 'pick'"
                (change)="scope.set('pick')"
              />
              {{ 'finance.io.scopePick' | t }}
            </label>
            @if (scope() === 'pick') {
              <div class="picks">
                @for (a of list; track a.id) {
                  <label class="opt">
                    <input type="checkbox" [checked]="picked().has(a.id)" (change)="toggle(a.id)" />
                    {{ a.name }}
                  </label>
                }
              </div>
            }
          </fieldset>
          <fieldset>
            <legend>{{ 'finance.io.periodTitle' | t }}</legend>
            <label class="opt">
              <input type="radio" name="period" [checked]="!range()" (change)="range.set(false)" />
              {{ 'finance.io.periodAll' | t }}
            </label>
            <label class="opt">
              <input type="radio" name="period" [checked]="range()" (change)="range.set(true)" />
              {{ 'finance.io.periodRange' | t }}
            </label>
            @if (range()) {
              <div class="dates">
                <label>
                  <span>{{ 'finance.io.from' | t }}</span>
                  <input
                    class="oh-input"
                    type="date"
                    [value]="fromDate()"
                    (input)="fromDate.set($any($event.target).value)"
                  />
                </label>
                <label>
                  <span>{{ 'finance.io.to' | t }}</span>
                  <input
                    class="oh-input"
                    type="date"
                    [value]="toDate()"
                    (input)="toDate.set($any($event.target).value)"
                  />
                </label>
              </div>
            }
          </fieldset>
          @if (problem(); as p) {
            <p class="problem" role="alert">{{ p | t }}</p>
          }
          <p class="legend">{{ 'finance.io.formatTitle' | t }}</p>
        }
        <button
          type="button"
          class="format"
          [disabled]="busy() || !!problem()"
          (click)="run('xlsx')"
        >
          <strong>Excel</strong>
          <small>{{
            (summary() ? 'finance.io.xlsxSummaryHint' : 'finance.io.xlsxHint') | t
          }}</small>
        </button>
        <button
          type="button"
          class="format"
          [disabled]="busy() || !!problem()"
          (click)="run('csv')"
        >
          <strong>CSV</strong>
          <small>{{ 'finance.io.csvHint' | t }}</small>
        </button>
        <button type="button" class="oh-btn oh-btn--text close" (click)="close()">
          {{ 'finance.io.close' | t }}
        </button>
      </div>
    </details>
  `,
  styles: `
    .menu-wrap {
      position: relative;
    }
    summary {
      list-style: none;
      cursor: pointer;
      &::-webkit-details-marker {
        display: none;
      }
    }
    .menu {
      position: absolute;
      z-index: 4;
      right: 0;
      top: calc(100% + 4px);
      display: grid;
      gap: 2px;
      width: min(300px, calc(100vw - 32px));
      max-height: min(70vh, 560px);
      overflow-y: auto;
      padding: 6px;
      background: var(--oh-surface);
      border: 1px solid var(--oh-border-strong);
      border-radius: var(--oh-radius);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
      @media (max-width: 839px) {
        position: fixed;
        z-index: 20;
        inset: auto 8px calc(8px + env(safe-area-inset-bottom)) 8px;
        width: auto;
        max-height: 75vh;
        padding: 10px;
        box-shadow: 0 -8px 32px rgb(0 0 0 / 0.25);
      }
    }
    fieldset {
      display: grid;
      gap: 2px;
      margin: 0 0 6px;
      padding: 0 6px;
      border: 0;
    }
    legend,
    .legend {
      margin: 4px 0;
      padding: 0 6px;
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--oh-text-muted);
    }
    legend {
      padding: 0;
    }
    .opt {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      cursor: pointer;
    }
    .opt input {
      accent-color: var(--oh-primary);
    }
    .picks {
      display: grid;
      padding-left: 24px;
    }
    .dates {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      font-size: 0.8125rem;
    }
    .dates label {
      display: grid;
      gap: 2px;
    }
    .problem {
      margin: 0 6px 4px;
      color: var(--oh-error);
      font-size: 0.875rem;
    }
    .format {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border: 0;
      border-radius: calc(var(--oh-radius) - 2px);
      background: transparent;
      color: var(--oh-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      &:hover,
      &:focus-visible {
        background: var(--oh-secondary-soft);
      }
      &:disabled {
        opacity: 0.6;
        cursor: default;
      }
    }
    small {
      color: var(--oh-text-muted);
    }
    .close {
      display: none;
      @media (max-width: 839px) {
        display: block;
        justify-self: end;
      }
    }
  `,
})
export class ExportMenuComponent {
  readonly familyId = input.required<string>();
  /** Cuentas a exportar (vacío: las activas que la persona ve) */
  readonly accounts = input<string[]>([]);
  readonly from = input<string | undefined>();
  readonly to = input<string | undefined>();
  /** Va en el nombre del archivo: la cuenta o "Resumen" */
  readonly subject = input.required<string>();
  readonly summary = input<Summary | undefined>();
  /**
   * Hoja de una cuenta: las cuentas que se pueden exportar junto con ella (la primera de
   * `accounts` es la de la hoja). Con esto el menú deja elegir cuentas y período.
   */
  readonly choices = input<{ id: string; name: string }[] | undefined>();

  private readonly io = inject(FinanceIoService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly details = viewChild.required<ElementRef<HTMLDetailsElement>>('details');
  protected readonly busy = signal(false);

  protected readonly scope = signal<Scope>('this');
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly range = signal(false);
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');

  private readonly currentId = computed(() => this.accounts()[0] ?? '');
  protected readonly currentName = computed(
    () => this.choices()?.find((a) => a.id === this.currentId())?.name ?? this.subject(),
  );

  /** Cuentas que se van a exportar (en el orden de las pestañas) */
  private readonly selected = computed<string[]>(() => {
    const list = this.choices();
    if (!list) return this.accounts();
    if (this.scope() === 'all') return list.map((a) => a.id);
    if (this.scope() === 'pick')
      return list.filter((a) => this.picked().has(a.id)).map((a) => a.id);
    return [this.currentId()];
  });

  protected readonly problem = computed(() => {
    if (!this.choices()) return null;
    if (!this.selected().length) return 'finance.io.pickNone' as const;
    const from = this.fromDate();
    const to = this.toDate();
    if (this.range() && from && to && from > to) return 'finance.io.rangeInvalid' as const;
    return null;
  });

  /** Se cierra al tocar fuera o con Esc */
  @HostListener('document:click', ['$event'])
  protected outside(event: Event): void {
    if (!this.details().nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.details().nativeElement.open = false;
  }

  protected toggle(id: string): void {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }

  /** Nombre del archivo: la cuenta, "Todas las cuentas", hasta 3 nombres o "5 cuentas" */
  private fileSubject(): string {
    const list = this.choices();
    if (!list) return this.subject();
    const ids = this.selected();
    if (this.scope() === 'all') return this.i18n.t('finance.io.subjectAll');
    const names = list.filter((a) => ids.includes(a.id)).map((a) => a.name);
    return names.length <= 3
      ? names.join(' + ')
      : this.i18n.t('finance.io.subjectMany', { n: names.length });
  }

  protected async run(format: 'xlsx' | 'csv'): Promise<void> {
    if (this.problem()) return;
    const choosing = !!this.choices();
    const period = choosing && this.range();
    this.busy.set(true);
    try {
      await this.io.download(
        this.familyId(),
        {
          accounts: this.selected(),
          from: choosing ? (period ? this.fromDate() || undefined : undefined) : this.from(),
          to: choosing ? (period ? this.toDate() || undefined : undefined) : this.to(),
        },
        format,
        this.fileSubject(),
        { summary: format === 'xlsx' ? this.summary() : undefined },
      );
      this.close();
    } catch (err) {
      this.toast.show(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
