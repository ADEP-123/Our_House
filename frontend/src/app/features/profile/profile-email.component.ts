import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { ProfileService } from './profile.service';

@Component({
  selector: 'oh-profile-email',
  imports: [ReactiveFormsModule, TPipe, PasswordFieldComponent],
  styleUrl: './profile-section.scss',
  template: `
    <h2>{{ 'profile.email.title' | t }}</h2>
    <form class="section-body oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <p class="oh-muted">{{ 'profile.email.current' | t: { email: auth.user()?.email ?? '' } }}</p>
      <div class="oh-field">
        <label for="newEmail">{{ 'profile.email.newEmail' | t }}</label>
        <input id="newEmail" class="oh-input" type="email" formControlName="newEmail" autocomplete="email" />
      </div>
      <oh-password-field [control]="form.controls.password" [label]="'profile.email.password' | t" />
      <div aria-live="polite">
        @if (message(); as msg) {
          <p class="oh-alert" [class.is-error]="isError()" [class.is-success]="!isError()">{{ msg }}</p>
        }
      </div>
      <div class="actions">
        <button class="oh-btn oh-btn--tonal" type="submit" [disabled]="form.invalid || busy()">
          {{ 'profile.email.submit' | t }}
        </button>
      </div>
    </form>
  `,
})
export class ProfileEmailComponent {
  protected readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    newEmail: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const { newEmail, password } = this.form.getRawValue();
      const { pendingEmail } = await this.profile.requestEmailChange(newEmail.trim(), password);
      this.form.reset();
      this.isError.set(false);
      this.message.set(this.i18n.t('profile.email.sent', { email: pendingEmail }));
    } catch (err) {
      this.isError.set(true);
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
