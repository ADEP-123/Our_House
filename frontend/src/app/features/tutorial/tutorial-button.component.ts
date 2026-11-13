import { Component, inject, input } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { TutorialId, TutorialService } from './tutorial.service';

/** Botón "?" del encabezado de cada módulo: vuelve a abrir su tutorial */
@Component({
  selector: 'oh-tutorial-button',
  imports: [TPipe],
  template: `
    <button
      type="button"
      class="help"
      [attr.aria-label]="'tutorial.help' | t"
      [title]="'tutorial.help' | t"
      (click)="tutorial.start(tutorialId())"
    >
      ?
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .help {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1.5px solid var(--oh-border-strong);
      background: var(--oh-surface);
      color: var(--oh-text-muted);
      font: inherit;
      font-weight: 800;
      font-size: 1rem;
      cursor: pointer;

      &:hover {
        border-color: var(--oh-primary);
        color: var(--oh-primary);
      }
    }
  `,
})
export class TutorialButtonComponent {
  readonly tutorialId = input.required<TutorialId>({ alias: 'tutorial' });
  protected readonly tutorial = inject(TutorialService);
}
