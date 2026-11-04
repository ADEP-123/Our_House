import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { passwordValidator, passwordsMatch } from '../../shared/password-rules';
import { ProfileService } from './profile.service';

@Component({
  selector: 'oh-profile-password',
  imports: [ReactiveFormsModule, TPipe, PasswordFieldComponent],
  styleUrl: './profile-section.scss',
  template: `
    <h2>{{ 'profile.password.title' | t }}</h2>
    <form class="section-body oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <oh-password-field [control]="form.controls.current" [label]="'profile.password.current' | t" />
      <oh-password-field
        [control]="form.controls.next"
        [label]="'profile.password.newPassword' | t"
        autocomplete="new-password"
        [showRules]="true"
      />
      <oh-password-field
        [control]="form.controls.confirm"
        [label]="'profile.password.confirm' | t"
        autocomplete="new-password"
        [invalid]="mismatch()"
      >
        @if (mismatch()) {
          <span class="oh-error">{{ 'auth.register.mismatch' | t }}</span>
        }
      </oh-password-field>
      <div aria-live="polite">
        @if (message(); as msg) {
          <p class="oh-alert" [class.is-error]="isError()" [class.is-success]="!isError()">{{ msg }}</p>
        }
      </div>
      <div class="actions">
        <button class="oh-btn oh-btn--tonal" type="submit" [disabled]="form.invalid || busy()">
          {{ 'profile.password.submit' | t }}
        </button>
      </div>
    </form>
  `,
})
export class ProfilePasswordComponent {
  private readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);
  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      current: ['', Validators.required],
      next: ['', [Validators.required, passwordValidator]],
      confirm: ['', Validators.required],
    },
    { validators: passwordsMatch('next', 'confirm') },
  );
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);

  protected mismatch(): boolean {
    return this.form.controls.confirm.value.length > 0 && this.form.hasError('mismatch');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const { current, next } = this.form.getRawValue();
      await this.profile.changePassword(current, next);
      this.form.reset();
      this.isError.set(false);
      this.message.set(this.i18n.t('profile.password.saved'));
    } catch (err) {
      this.isError.set(true);
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
