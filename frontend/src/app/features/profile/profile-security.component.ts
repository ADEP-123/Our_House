import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { ProfileService } from './profile.service';

/** Cerrar todas las sesiones y eliminar la cuenta. */
@Component({
  selector: 'oh-profile-security',
  imports: [ReactiveFormsModule, TPipe, PasswordFieldComponent],
  styleUrl: './profile-section.scss',
  template: `
    <h2>{{ 'profile.sessions.title' | t }}</h2>
    <div class="section-body">
      <p class="oh-muted">{{ 'profile.sessions.body' | t }}</p>
      <div class="actions">
        <button type="button" class="oh-btn oh-btn--outline" (click)="logoutAll()" [disabled]="busy()">
          {{ 'profile.sessions.logoutAll' | t }}
        </button>
      </div>
    </div>

    <h2 class="danger-title">{{ 'profile.danger.title' | t }}</h2>
    <div class="section-body">
      <p class="oh-muted">{{ 'profile.danger.body' | t }}</p>
      @if (!confirming()) {
        <div class="actions">
          <button type="button" class="oh-btn oh-btn--outline danger" (click)="confirming.set(true)">
            {{ 'profile.danger.start' | t }}
          </button>
        </div>
      } @else {
        <form class="oh-form" (ngSubmit)="deleteAccount()" novalidate>
          <oh-password-field [control]="password" [label]="'profile.danger.password' | t" />
          @if (message(); as msg) {
            <p class="oh-alert is-error" role="alert">{{ msg }}</p>
          }
          <div class="actions">
            <button type="submit" class="oh-btn oh-btn--danger" [disabled]="password.invalid || busy()">
              {{ 'profile.danger.confirm' | t }}
            </button>
            <button type="button" class="oh-btn oh-btn--text" (click)="cancel()">{{ 'profile.danger.cancel' | t }}</button>
          </div>
        </form>
      }
    </div>
  `,
  styles: `
    .danger-title {
      color: var(--oh-error);
    }
    .danger {
      color: var(--oh-error);
      border-color: color-mix(in srgb, var(--oh-error) 45%, transparent);
    }
    @media (min-width: 1024px) {
      .danger-title {
        margin-top: 12px;
      }
    }
  `,
})
export class ProfileSecurityComponent {
  private readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);
  protected readonly password = new FormControl('', { nonNullable: true, validators: Validators.required });
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  async logoutAll(): Promise<void> {
    this.busy.set(true);
    await this.auth.logoutAll().finally(() => this.busy.set(false));
  }

  cancel(): void {
    this.confirming.set(false);
    this.password.reset();
    this.message.set(null);
  }

  async deleteAccount(): Promise<void> {
    if (this.password.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      await this.profile.deleteAccount(this.password.value);
      this.auth.endSession();
    } catch (err) {
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
