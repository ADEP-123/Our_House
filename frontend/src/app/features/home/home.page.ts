import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { TPipe } from '../../core/i18n/t.pipe';

@Component({
  selector: 'oh-home-page',
  imports: [TPipe],
  template: `
    <h1>{{ 'home.greeting' | t: { name: auth.user()?.nickname ?? '' } }}</h1>
    <p class="intro">{{ 'home.intro' | t }}</p>
  `,
  styles: `
    h1 {
      font-size: 2rem;
    }
    .intro {
      margin-top: 8px;
      max-width: 60ch;
      color: var(--oh-text-muted);
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
}
