import { Component, computed, input } from '@angular/core';

/** Íconos de trazo propios (24x24) para no cargar una librería de íconos completa. */
const ICONS = {
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
} as const;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'oh-icon',
  template: `<svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
  styles: `
    :host {
      display: inline-flex;
      width: 24px;
      height: 24px;
    }
    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  protected readonly d = computed(() => ICONS[this.name()]);
}
