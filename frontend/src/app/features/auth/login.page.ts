import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PasswordFieldComponent } from '../../shared/password-field.component';

@Component({
  selector: 'oh-login-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe, PasswordFieldComponent],
  styleUrl: './auth-page.scss',
  template: `
    <h1>{{ 'auth.login.title' | t }}</h1>

    <form class="oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      @if (message(); as msg) {
        <div class="oh-alert is-error" role="alert">
          <p>{{ msg }}</p>
          @if (unverifiedEmail()) {
            <button type="button" class="oh-btn oh-btn--text resend" (click)="resend()">
              {{ 'auth.login.resend' | t }}
            </button>
          }
        </div>
      }

      <div class="oh-field">
        <label for="identifier">{{ 'auth.login.identifier' | t }}</label>
        <input
          id="identifier"
          class="oh-input"
          formControlName="identifier"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
        />
      </div>

      <oh-password-field [control]="form.controls.password" [label]="'auth.login.password' | t" />

      <div class="row-end">
        <a routerLink="/recuperar-contrasena">{{ 'auth.login.forgot' | t }}</a>
      </div>

      <button class="oh-btn oh-btn--filled oh-btn--block" type="submit" [disabled]="form.invalid || busy()">
        {{ 'auth.login.submit' | t }}
      </button>
    </form>

    <p class="links">
      <span>{{ 'auth.login.noAccount' | t }} <a routerLink="/registro">{{ 'auth.login.register' | t }}</a></span>
    </p>
  `,
  styles: `
    .resend {
      margin: 6px 0 0 -12px;
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18n);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    identifier: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly unverifiedEmail = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    this.unverifiedEmail.set(null);
    try {
      const { identifier, password } = this.form.getRawValue();
      await this.auth.login(identifier.trim(), password);
      const back = this.route.snapshot.queryParamMap.get('volver');
      await this.router.navigateByUrl(back?.startsWith('/') ? back : '/inicio');
    } catch (err) {
      const error = toApiError(err);
      if (error.code === 'INVALID_CREDENTIALS' && typeof error.details['attemptsLeft'] === 'number') {
        this.message.set(this.i18n.t('auth.login.attemptsLeft', { n: error.details['attemptsLeft'] }));
      } else if (error.code === 'ACCOUNT_LOCKED') {
        const time = new Date(String(error.details['lockedUntil'])).toLocaleTimeString(this.i18n.locale(), {
          hour: 'numeric',
          minute: '2-digit',
        });
        this.message.set(this.i18n.t('auth.login.locked', { time }));
      } else if (error.code === 'EMAIL_NOT_VERIFIED') {
        this.message.set(this.i18n.t('auth.login.notVerified'));
        this.unverifiedEmail.set(String(error.details['email']));
      } else {
        this.message.set(this.i18n.error(error.code));
      }
    } finally {
      this.busy.set(false);
    }
  }

  async resend(): Promise<void> {
    const email = this.unverifiedEmail();
    if (!email) return;
    await this.auth.resendVerification(email).catch(() => undefined);
    await this.router.navigate(['/revisa-tu-correo'], { queryParams: { correo: email } });
  }
}
