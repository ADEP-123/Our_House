import { Component, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { TutorialService } from './tutorial.service';

/** Aviso fijo arriba de cada práctica: nada se guarda, y "Salir" deja el tutorial donde iba */
@Component({
  selector: 'oh-practice-banner',
  imports: [TPipe],
  template: `
    <div class="banner" role="note">
      <span>🎓 {{ 'tutorial.banner' | t }}</span>
      <button type="button" class="oh-btn oh-btn--text" (click)="tutorial.pause()">
        {{ 'tutorial.exit' | t }}
      </button>
    </div>
  `,
  styles: `
    .banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 12px;
      margin-bottom: 18px;
      padding: 8px 8px 8px 14px;
      border-radius: var(--oh-radius);
      border: 1px dashed var(--oh-primary);
      background: color-mix(in srgb, var(--oh-primary) 8%, var(--oh-surface));
      font-size: 0.9375rem;
      font-weight: 600;
    }
  `,
})
export class PracticeBannerComponent {
  protected readonly tutorial = inject(TutorialService);
}
