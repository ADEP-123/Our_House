import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { passwordValidator, passwordsMatch } from '../../shared/password-rules';

type NicknameState = 'idle' | 'checking' | 'available' | 'taken';
const NICKNAME_PATTERN = /^[\p{L}\p{N}_.-]+$/u;

@Component({
  selector: 'oh-register-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe, PasswordFieldComponent],
  styleUrl: './auth-page.scss',
  template: `
    <h1>{{ 'auth.register.title' | t }}</h1>

    <form class="oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      @if (message(); as msg) {
        <p class="oh-alert is-error" role="alert">{{ msg }}</p>
      }

      <div class="oh-field">
        <label for="email">{{ 'auth.register.email' | t }}</label>
        <input
          id="email"
          class="oh-input"
          type="email"
          formControlName="email"
          autocomplete="email"
          [attr.aria-invalid]="showError('email') || null"
          aria-describedby="email-msg"
        />
        <span id="email-msg" aria-live="polite">
          @if (fieldError('email'); as err) {
            <span class="oh-error">{{ err }}</span>
          }
        </span>
      </div>

      <div class="oh-field">
        <label for="nickname">{{ 'auth.register.nickname' | t }}</label>
        <input
          id="nickname"
          class="oh-input"
          formControlName="nickname"
          autocomplete="nickname"
          autocapitalize="none"
          spellcheck="false"
          [attr.aria-invalid]="nicknameState() === 'taken' || showError('nickname') || null"
          aria-describedby="nickname-msg"
        />
        <span id="nickname-msg" aria-live="polite">
          @if (fieldError('nickname'); as err) {
            <span class="oh-error">{{ err }}</span>
          } @else {
            @switch (nicknameState()) {
              @case ('checking') {
                <span class="oh-hint">{{ 'auth.register.nicknameChecking' | t }}</span>
              }
              @case ('available') {
                <span class="oh-ok">✓ {{ 'auth.register.nicknameAvailable' | t }}</span>
              }
              @case ('taken') {
                <span class="oh-error">{{ 'errors.NICKNAME_TAKEN' | t }}</span>
              }
              @default {
                <span class="oh-hint">{{ 'auth.register.nicknameHint' | t }}</span>
              }
            }
          }
        </span>
      </div>

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
        <span aria-live="polite">
          @if (mismatch()) {
            <span class="oh-error">{{ 'auth.register.mismatch' | t }}</span>
          }
        </span>
      </oh-password-field>

      <button
        class="oh-btn oh-btn--filled oh-btn--block"
        type="submit"
        [disabled]="form.invalid || nicknameState() === 'taken' || busy()"
      >
        {{ 'auth.register.submit' | t }}
      </button>
    </form>

    <p class="links">
      <span>{{ 'auth.register.haveAccount' | t }} <a routerLink="/ingresar">{{ 'auth.register.login' | t }}</a></span>
    </p>
  `,
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      nickname: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(30), Validators.pattern(NICKNAME_PATTERN)]],
      password: ['', [Validators.required, passwordValidator]],
      confirm: ['', Validators.required],
    },
    { validators: passwordsMatch('password', 'confirm') },
  );

  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly nicknameState = signal<NicknameState>('idle');
  /** Errores que devolvió la API por campo (ej. correo ya registrado) */
  private readonly serverErrors = signal<Record<string, string>>({});

  constructor() {
    // Disponibilidad del apodo mientras se escribe (espera 400 ms de pausa)
    const nickname = this.form.controls.nickname;
    nickname.valueChanges
      .pipe(
        map((v) => v.trim()),
        distinctUntilChanged(),
        tap(() => this.nicknameState.set(nickname.valid ? 'checking' : 'idle')),
        debounceTime(400),
        switchMap((value) =>
          nickname.valid
            ? this.auth.isNicknameAvailable(value).pipe(
                map((r) => (r.available ? 'available' : 'taken') as NicknameState),
                catchError(() => of<NicknameState>('idle')),
              )
            : of<NicknameState>('idle'),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((state) => this.nicknameState.set(state));

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.serverErrors.set({}));
  }

  protected showError(name: 'email' | 'nickname'): boolean {
    const control = this.form.controls[name];
    return (control.invalid && control.touched) || !!this.serverErrors()[name];
  }

  protected fieldError(name: 'email' | 'nickname'): string | null {
    const server = this.serverErrors()[name];
    if (server) return this.i18n.error(server);
    const control = this.form.controls[name];
    if (!control.touched || control.valid) return null;
    if (control.hasError('required')) return this.i18n.t('errors.required');
    if (name === 'email') return this.i18n.t('errors.EMAIL_INVALID');
    if (control.hasError('minlength')) return this.i18n.t('errors.NICKNAME_TOO_SHORT');
    if (control.hasError('maxlength')) return this.i18n.t('errors.NICKNAME_TOO_LONG');
    return this.i18n.t('errors.NICKNAME_INVALID');
  }

  protected mismatch(): boolean {
    return this.form.controls.confirm.value.length > 0 && this.form.hasError('mismatch');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const { email, nickname, password } = this.form.getRawValue();
      const result = await this.auth.register({ email: email.trim(), nickname: nickname.trim(), password });
      await this.router.navigate(['/revisa-tu-correo'], { queryParams: { correo: result.email } });
    } catch (err) {
      const error = toApiError(err);
      if (error.code === 'EMAIL_TAKEN') this.serverErrors.set({ email: error.code });
      else if (error.code === 'NICKNAME_TAKEN') this.nicknameState.set('taken');
      else if (error.code === 'VALIDATION') this.serverErrors.set(error.fields);
      else this.message.set(this.i18n.error(error.code));
    } finally {
      this.busy.set(false);
    }
  }
}
