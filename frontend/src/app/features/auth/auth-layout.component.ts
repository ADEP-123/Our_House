import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TPipe } from '../../core/i18n/t.pipe';
import { LangSwitchComponent } from '../../shared/lang-switch.component';

/**
 * Marco de las pantallas de acceso. En escritorio, el panel izquierdo usa el color principal
 * del usuario con la marca en grande; en móvil solo queda el formulario.
 */
@Component({
  selector: 'oh-auth-layout',
  imports: [RouterOutlet, TPipe, LangSwitchComponent],
  template: `
    <div class="auth">
      <aside class="brand">
        <svg class="roof" viewBox="0 0 120 40" aria-hidden="true"><path d="M4 36 60 6l56 30" /></svg>
        <p class="word" aria-hidden="true">Our<br />House</p>
        <p class="tagline">{{ 'auth.tagline' | t }}</p>
      </aside>
      <main class="content">
        <header class="top">
          <span class="mini">Our House</span>
          <oh-lang-switch />
        </header>
        <div class="form-area">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
  styles: `
    .auth {
      min-height: 100dvh;
      display: grid;
    }
    .brand {
      display: none;
    }
    .content {
      display: flex;
      flex-direction: column;
      padding: 20px 20px 40px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32px;
    }
    .mini {
      font-weight: 800;
      font-size: 1.25rem;
      color: var(--oh-primary);
      letter-spacing: -0.02em;
    }
    .form-area {
      width: 100%;
      max-width: 420px;
      margin: 0 auto;
    }
    @media (min-width: 960px) {
      .auth {
        grid-template-columns: minmax(380px, 5fr) 6fr;
      }
      .brand {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 56px;
        background: var(--oh-primary);
        color: var(--oh-on-primary);
      }
      .roof {
        width: clamp(140px, 14vw, 220px);
        fill: none;
        stroke: currentColor;
        stroke-width: 5;
        stroke-linecap: round;
        stroke-linejoin: round;
        margin-bottom: 4px;
      }
      .word {
        font-size: clamp(4.5rem, 9vw, 8.5rem);
        font-weight: 800;
        line-height: 0.88;
        letter-spacing: -0.045em;
      }
      .tagline {
        margin-top: 28px;
        font-size: 1.25rem;
        max-width: 22ch;
        opacity: 0.88;
      }
      .content {
        padding: 32px 56px;
      }
      .mini {
        visibility: hidden;
      }
      .form-area {
        margin: auto;
      }
    }
  `,
})
export class AuthLayoutComponent {}
