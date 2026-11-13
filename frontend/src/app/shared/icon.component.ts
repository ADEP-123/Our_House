import { Component, computed, input } from '@angular/core';

/** Íconos de trazo propios (24x24) para no cargar una librería de íconos completa. */
const ICONS = {
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  list: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  task: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 12l2.5 2.5 4.5-5',
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A1.5 1.5 0 0 0 5.5 9H19a1 1 0 0 1 1 1v2h-3.5a1.5 1.5 0 0 0 0 3H20',
  family: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M15 14.6c.6-.1 1.3-.1 2-.1 2.3 0 4 1.2 4.6 3.5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4.1-4-7.2-9-7.2zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01',
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
