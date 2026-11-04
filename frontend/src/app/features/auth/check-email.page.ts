import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TPipe } from '../../core/i18n/t.pipe';

const COOLDOWN_SECONDS = 60;

@Component({
  selector: 'oh-check-email-page',
  imports: [RouterLink, TPipe],
  styleUrl: './auth-page.scss',
  template: `
    <svg class="envelope" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="5" y="11" width="38" height="27" rx="5" />
      <path d="m7 14 17 13 17-13" />
    </svg>
    <h1>{{ 'auth.checkEmail.title' | t }}</h1>
    <p class="lead">{{ 'auth.checkEmail.body' | t: { email: email } }} {{ 'auth.checkEmail.spam' | t }}</p>

    <div aria-live="polite">
      @if (resent()) {
        <p class="oh-alert is-success">{{ 'auth.checkEmail.resent' | t }}</p>
      }
    </div>

    <p class="links">
      <button type="button" class="oh-btn oh-btn--tonal" [disabled]="cooldown() > 0" (click)="resend()">
        {{ cooldown() > 0 ? ('auth.checkEmail.resendIn' | t: { s: cooldown() }) : ('auth.checkEmail.resend' | t) }}
      </button>
      <a routerLink="/ingresar">{{ 'auth.checkEmail.backToLogin' | t }}</a>
    </p>
  `,
  styles: `
    .envelope {
      width: 56px;
      height: 56px;
      fill: var(--oh-primary-soft);
      stroke: var(--oh-primary);
      stroke-width: 2.2;
      stroke-linejoin: round;
      margin-bottom: 16px;
    }
  `,
})
export class CheckEmailPage {
  private readonly auth = inject(AuthService);
  protected readonly email = inject(ActivatedRoute).snapshot.queryParamMap.get('correo') ?? '';
  protected readonly cooldown = signal(COOLDOWN_SECONDS);
  protected readonly resent = signal(false);

  constructor() {
    const timer = setInterval(() => this.cooldown.update((s) => Math.max(0, s - 1)), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async resend(): Promise<void> {
    if (!this.email) return;
    this.cooldown.set(COOLDOWN_SECONDS);
    await this.auth.resendVerification(this.email).catch(() => undefined);
    this.resent.set(true);
  }
}
