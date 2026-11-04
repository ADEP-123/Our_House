import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { LangSwitchComponent } from '../../shared/lang-switch.component';
import { LEGAL, UPDATED_AT } from './legal-content';

/** /privacidad y /terminos: públicas, sin sesión, en el idioma elegido. */
@Component({
  selector: 'oh-legal-page',
  imports: [RouterLink, TPipe, LangSwitchComponent],
  template: `
    <div class="page">
      <header class="top">
        <a class="brand" routerLink="/">Our House</a>
        <oh-lang-switch />
      </header>
      <article>
        <h1>{{ content().title }}</h1>
        <p class="updated">{{ 'legal.updated' | t: { date: updated() } }}</p>
        <p class="intro">{{ content().intro }}</p>
        @for (section of content().sections; track section.title) {
          <section>
            <h2>{{ section.title }}</h2>
            @for (p of section.paragraphs; track $index) {
              <p>{{ p }}</p>
            }
          </section>
        }
      </article>
      <footer>
        @if (doc() === 'privacy') {
          <a routerLink="/terminos">{{ 'legal.terms' | t }}</a>
        } @else {
          <a routerLink="/privacidad">{{ 'legal.privacy' | t }}</a>
        }
        <a routerLink="/">{{ 'legal.back' | t }}</a>
      </footer>
    </div>
  `,
  styles: `
    .page {
      max-width: 720px;
      margin: 0 auto;
      padding: 20px 20px 56px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32px;
    }
    .brand {
      font-weight: 800;
      font-size: 1.25rem;
      color: var(--oh-primary);
      text-decoration: none;
      letter-spacing: -0.02em;
    }
    h1 {
      font-size: clamp(1.75rem, 5vw, 2.25rem);
      line-height: 1.15;
    }
    .updated {
      margin-top: 6px;
      color: var(--oh-text-muted);
      font-size: 0.875rem;
    }
    .intro {
      margin-top: 20px;
      font-size: 1.0625rem;
    }
    section {
      margin-top: 28px;
    }
    h2 {
      font-size: 1.125rem;
      margin-bottom: 8px;
    }
    p {
      line-height: 1.6;
    }
    p + p {
      margin-top: 10px;
    }
    footer {
      display: flex;
      gap: 20px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--oh-border);
    }
    footer a {
      color: var(--oh-primary);
    }
  `,
})
export class LegalPage {
  /** Viene de la ruta (data) */
  readonly doc = input<'privacy' | 'terms'>('privacy');
  private readonly i18n = inject(I18n);

  protected readonly content = computed(() => LEGAL[this.i18n.locale() === 'en' ? 'en' : 'es'][this.doc()]);
  protected readonly updated = computed(() =>
    new Date(`${UPDATED_AT}T12:00:00`).toLocaleDateString(this.i18n.locale(), { day: 'numeric', month: 'long', year: 'numeric' }),
  );
}
