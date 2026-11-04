import { Component, inject, output } from '@angular/core';
import { I18n, Locale } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/t.pipe';

/** Selector ES / EN. Emite el idioma elegido para que el perfil lo guarde si hay sesión. */
@Component({
  selector: 'oh-lang-switch',
  imports: [TPipe],
  template: `
    <div class="switch" role="group" [attr.aria-label]="'common.language' | t">
      @for (option of options; track option.value) {
        <button
          type="button"
          [attr.aria-pressed]="i18n.locale() === option.value"
          [attr.lang]="option.value"
          (click)="select(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
  styles: `
    .switch {
      display: inline-flex;
      padding: 3px;
      border: 1px solid var(--oh-border);
      border-radius: 999px;
      background: var(--oh-surface);
    }
    button {
      min-width: 44px;
      min-height: 32px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--oh-text-muted);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }
    button[aria-pressed='true'] {
      background: var(--oh-primary);
      color: var(--oh-on-primary);
    }
  `,
})
export class LangSwitchComponent {
  protected readonly i18n = inject(I18n);
  readonly changed = output<Locale>();

  protected readonly options: { value: Locale; label: string }[] = [
    { value: 'es', label: 'ES' },
    { value: 'en', label: 'EN' },
  ];

  select(locale: Locale): void {
    this.i18n.setLocale(locale);
    this.changed.emit(locale);
  }
}
