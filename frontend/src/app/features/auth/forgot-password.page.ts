import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';

@Component({
  selector: 'oh-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe],
  styleUrl: './auth-page.scss',
  template: `
    <h1>{{ 'auth.forgot.title' | t }}</h1>
    @if (sentTo(); as email) {
      <p class="oh-alert is-success" role="status">{{ 'auth.forgot.sent' | t: { email } }}</p>
    } @else {
      <p class="lead">{{ 'auth.forgot.body' | t }}</p>
      <form class="oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        @if (message(); as msg) {
          <p class="oh-alert is-error" role="alert">{{ msg }}</p>
        }
        <div class="oh-field">
          <label for="email">{{ 'auth.register.email' | t }}</label>
          <input id="email" class="oh-input" type="email" formControlName="email" autocomplete="email" />
        </div>
        <button class="oh-btn oh-btn--filled oh-btn--block" type="submit" [disabled]="form.invalid || busy()">
          {{ 'auth.forgot.submit' | t }}
        </button>
      </form>
    }
    <p class="links">
      <a routerLink="/ingresar">{{ 'auth.forgot.backToLogin' | t }}</a>
    </p>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly busy = signal(false);
  protected readonly sentTo = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    const email = this.form.controls.email.value.trim();
    try {
      await this.auth.forgotPassword(email);
      this.sentTo.set(email);
    } catch (err) {
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
