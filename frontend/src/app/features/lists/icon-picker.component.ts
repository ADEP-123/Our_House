import { Component, computed, inject, input, output, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ICON_GROUPS, IconGroupId, isSingleEmoji, searchIcons } from './list-icons';
import { iconOf } from './list-presets';

/** Elegir el ícono de una lista: íconos agrupados con búsqueda, o cualquier emoji escrito a mano */
@Component({
  selector: 'oh-icon-picker',
  imports: [TPipe],
  template: `
    <div class="top">
      <span class="current" aria-hidden="true">{{ current() }}</span>
      <label class="oh-sr-only" for="icon-search">{{ 'lists.icons.search' | t }}</label>
      <input
        id="icon-search"
        class="oh-input"
        type="search"
        autocomplete="off"
        [placeholder]="'lists.icons.searchPlaceholder' | t"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        (keydown.enter)="$event.preventDefault()"
      />
    </div>

    <div class="scroll">
      @for (g of groups(); track g.id) {
        <section>
          <h4>{{ groupName(g.id) }}</h4>
          <div class="grid">
            @for (i of g.icons; track i.emoji) {
              <button
                type="button"
                class="icon"
                [attr.aria-pressed]="current() === i.emoji"
                [attr.aria-label]="'lists.icons.choose' | t: { icon: i.emoji }"
                [title]="i.words"
                (click)="valueChange.emit(i.emoji)"
              >
                {{ i.emoji }}
              </button>
            }
          </div>
        </section>
      } @empty {
        <p class="oh-hint">{{ 'lists.icons.empty' | t: { query: query() } }}</p>
      }
    </div>

    <div class="custom">
      <label for="icon-custom">{{ 'lists.icons.custom' | t }}</label>
      <div class="custom-row">
        <input
          id="icon-custom"
          class="oh-input"
          maxlength="16"
          autocomplete="off"
          [placeholder]="'lists.icons.customPlaceholder' | t"
          [value]="custom()"
          (input)="custom.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); useCustom()"
        />
        <button
          type="button"
          class="oh-btn oh-btn--outline"
          [disabled]="!custom().trim()"
          (click)="useCustom()"
        >
          {{ 'lists.icons.use' | t }}
        </button>
      </div>
      @if (invalid()) {
        <p class="oh-error" role="alert">{{ 'lists.icons.invalid' | t }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 10px;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .current {
      display: grid;
      place-items: center;
      flex: none;
      width: 48px;
      height: 48px;
      border-radius: 14px;
      border: 2px solid var(--oh-primary);
      background: var(--oh-background);
      font-size: 1.5rem;
    }
    .top input {
      flex: 1;
    }
    .scroll {
      max-height: 260px;
      overflow-y: auto;
      padding: 4px 2px;
      border-radius: 12px;
      overscroll-behavior: contain;
    }
    section + section {
      margin-top: 10px;
    }
    h4 {
      margin: 0 0 6px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--oh-text-muted);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
      gap: 6px;
    }
    .icon {
      display: grid;
      place-items: center;
      height: 44px;
      border-radius: 12px;
      border: 2px solid transparent;
      background: var(--oh-background);
      font-size: 1.3rem;
      cursor: pointer;
    }
    .icon:hover {
      border-color: var(--oh-border-strong);
    }
    .icon[aria-pressed='true'] {
      border-color: var(--oh-primary);
      background: color-mix(in srgb, var(--oh-primary) 12%, var(--oh-surface));
    }
    .custom {
      display: grid;
      gap: 6px;
    }
    .custom label {
      font-size: 0.875rem;
      font-weight: 500;
    }
    .custom-row {
      display: flex;
      gap: 8px;
    }
    .custom-row input {
      flex: 1;
    }
  `,
})
export class IconPickerComponent {
  /** Ícono actual: un nombre de los primeros íconos o un emoji */
  readonly value = input.required<string>();
  readonly valueChange = output<string>();

  private readonly i18n = inject(I18n);
  protected readonly query = signal('');
  protected readonly custom = signal('');
  protected readonly invalid = signal(false);
  protected readonly current = computed(() => iconOf(this.value()));
  private readonly groupNames = computed(
    () =>
      Object.fromEntries(ICON_GROUPS.map((g) => [g.id, this.groupName(g.id)])) as Record<
        IconGroupId,
        string
      >,
  );
  protected readonly groups = computed(() => searchIcons(this.query(), this.groupNames()));

  protected groupName(id: IconGroupId): string {
    return this.i18n.t(`lists.icons.groups.${id}`);
  }

  protected useCustom(): void {
    const emoji = this.custom().trim();
    if (!isSingleEmoji(emoji)) {
      this.invalid.set(true);
      return;
    }
    this.invalid.set(false);
    this.custom.set('');
    this.valueChange.emit(emoji);
  }
}
