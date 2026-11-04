import { Component, inject, signal } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { AvatarPickerComponent } from '../../shared/avatar-picker.component';
import { ProfileService } from './profile.service';

@Component({
  selector: 'oh-profile-photo',
  imports: [TPipe, AvatarPickerComponent],
  styleUrl: './profile-section.scss',
  template: `
    <h2>{{ 'profile.photo.title' | t }}</h2>
    <div class="section-body">
      @if (auth.user(); as user) {
        <oh-avatar-picker
          [name]="user.nickname"
          [url]="user.avatarUrl"
          [presetId]="user.avatarPreset"
          [busy]="busy()"
          (upload)="run(profile.uploadAvatar($event))"
          (pick)="run(profile.setAvatarPreset($event))"
        />
      }
      <div aria-live="polite">
        @if (message(); as msg) {
          <p class="oh-alert" [class.is-error]="isError()" [class.is-success]="!isError()">{{ msg }}</p>
        }
      </div>
    </div>
  `,
})
export class ProfilePhotoComponent {
  protected readonly auth = inject(AuthService);
  protected readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);

  async run(request: Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await request;
      this.isError.set(false);
      this.message.set(this.i18n.t('profile.photo.saved'));
    } catch (err) {
      this.isError.set(true);
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
