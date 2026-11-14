import { Component, computed, inject } from '@angular/core';
import { PracticeBannerComponent } from '../../tutorial/practice-banner.component';
import { TutorialService } from '../../tutorial/tutorial.service';

/** En las pantallas de Finanzas, el aviso de la práctica mientras dura su tutorial */
@Component({
  selector: 'oh-finance-practice-banner',
  imports: [PracticeBannerComponent],
  template: `
    @if (show()) {
      <oh-practice-banner />
    }
  `,
})
export class FinancePracticeBannerComponent {
  private readonly tutorial = inject(TutorialService);
  protected readonly show = computed(() => this.tutorial.tour()?.id === 'finance');
}
