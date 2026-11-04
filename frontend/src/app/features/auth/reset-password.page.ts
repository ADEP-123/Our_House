import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { passwordValidator, passwordsMatch } from '../../shared/password-rules';

/** Destino del enlace del correo de recuperación. */
@Component({
  selector: 'oh-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe, PasswordFieldComponent],
  styleUrl: './auth-page.scss',
  template: `
    <h1>{{ 'auth.reset.title' | t }}</h1>
    @if (done()) {
      <p class="oh-alert is-success" role="status">{{ 'auth.reset.done' | t }}</p>
      <p class="links"><a class="oh-btn oh-btn--filled" routerLink="/ingresar">{{ 'auth.reset.goLogin' | t }}</a></p>
    } @else if (!token) {
      <p class="oh-alert is-error">{{ 'auth.reset.missingToken' | t }}</p>
      <p class="links"><a routerLink="/recuperar-contrasena">{{ 'auth.reset.askNew' | t }}</a></p>
    } @else {
      <p class="lead">{{ 'auth.reset.body' | t }}</p>
      <form class="oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        @if (message(); as msg) {
          <div class="oh-alert is-error" role="alert">
            <p>{{ msg }}</p>
            <a routerLink="/recuperar-contrasena">{{ 'auth.reset.askNew' | t }}</a>
          </div>
        }
        <oh-password-field
          [control]="form.controls.password"
          [label]="'auth.register.password' | t"
          autocomplete="new-password"
          [showRules]="true"
        />
        <oh-password-field
          [control]="form.controls.confirm"
          [label]="'auth.register.confirm' | t"
          autocomplete="new-password"
          [invalid]="mismatch()"
        >
          @if (mismatch()) {
            <span class="oh-error">{{ 'auth.register.mismatch' | t }}</span>
          }
        </oh-password-field>
        <button class="oh-btn oh-btn--filled oh-btn--block" type="submit" [disabled]="form.invalid || busy()">
          {{ 'auth.reset.submit' | t }}
        </button>
      </form>
    }
  `,
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      password: ['', [Validators.required, passwordValidator]],
      confirm: ['', Validators.required],
    },
    { validators: passwordsMatch('password', 'confirm') },
  );
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly message = signal<string | null>(null);

  protected mismatch(): boolean {
    return this.form.controls.confirm.value.length > 0 && this.form.hasError('mismatch');
  }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.token) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      await this.auth.resetPassword(this.token, this.form.controls.password.value);
      this.done.set(true);
    } catch (err) {
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
