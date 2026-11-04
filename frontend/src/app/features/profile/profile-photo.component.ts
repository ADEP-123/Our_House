import { Component, inject, signal } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { USER_AVATAR_PRESETS } from '../../shared/avatar-presets';
import { AvatarComponent } from '../../shared/avatar.component';
import { ProfileService } from './profile.service';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

@Component({
  selector: 'oh-profile-photo',
  imports: [TPipe, AvatarComponent],
  styleUrl: './profile-section.scss',
  template: `
    <h2>{{ 'profile.photo.title' | t }}</h2>
    <div class="section-body">
      @if (auth.user(); as user) {
        <div class="current">
          <oh-avatar [name]="user.nickname" [url]="user.avatarUrl" [presetId]="user.avatarPreset" [size]="72" />
          <div class="upload">
            <label class="oh-btn oh-btn--tonal" [class.disabled]="busy()">
              {{ (busy() ? 'profile.photo.uploading' : 'profile.photo.upload') | t }}
              <input type="file" class="oh-sr-only" accept="image/png,image/jpeg,image/webp" (change)="upload($event)" [disabled]="busy()" />
            </label>
            <span class="oh-hint">{{ 'profile.photo.hint' | t }}</span>
          </div>
        </div>

        <p class="oh-hint">{{ 'profile.photo.orPick' | t }}</p>
        <div class="presets" role="radiogroup" [attr.aria-label]="'profile.photo.orPick' | t">
          @for (preset of presets; track preset.id) {
            <button
              type="button"
              role="radio"
              class="preset"
              [attr.aria-checked]="!user.avatarUrl && user.avatarPreset === preset.id"
              [attr.aria-label]="preset.id"
              (click)="pick(preset.id)"
            >
              <oh-avatar [name]="preset.id" [presetId]="preset.id" [size]="44" />
            </button>
          }
          <button
            type="button"
            role="radio"
            class="preset"
            [attr.aria-checked]="!user.avatarUrl && !user.avatarPreset"
            [attr.aria-label]="'profile.photo.useInitials' | t"
            [title]="'profile.photo.useInitials' | t"
            (click)="pick(null)"
          >
            <oh-avatar [name]="user.nickname" [size]="44" />
          </button>
        </div>
      }
      <div aria-live="polite">
        @if (message(); as msg) {
          <p class="oh-alert" [class.is-error]="isError()" [class.is-success]="!isError()">{{ msg }}</p>
        }
      </div>
    </div>
  `,
  styles: `
    .current {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .upload {
      display: grid;
      gap: 6px;
      justify-items: start;
    }
    .disabled {
      opacity: 0.5;
      pointer-events: none;
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .preset {
      padding: 3px;
      border: 2px solid transparent;
      border-radius: 50%;
      background: none;
      cursor: pointer;
      line-height: 0;
    }
    .preset[aria-checked='true'] {
      border-color: var(--oh-primary);
    }
  `,
})
export class ProfilePhotoComponent {
  protected readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);
  protected readonly presets = USER_AVATAR_PRESETS;
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);

  private async run(work: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await work();
      this.isError.set(false);
      this.message.set(this.i18n.t('profile.photo.saved'));
    } catch (err) {
      this.isError.set(true);
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Se revisa antes de subir para no gastar datos en un archivo que la API rechazará
    if (!TYPES.includes(file.type)) {
      this.isError.set(true);
      this.message.set(this.i18n.error('FILE_TYPE_NOT_ALLOWED'));
      return;
    }
    if (file.size > MAX_BYTES) {
      this.isError.set(true);
      this.message.set(this.i18n.error('FILE_TOO_LARGE'));
      return;
    }
    void this.run(() => this.profile.uploadAvatar(file));
  }

  pick(preset: string | null): void {
    void this.run(() => this.profile.setAvatarPreset(preset));
  }
}
