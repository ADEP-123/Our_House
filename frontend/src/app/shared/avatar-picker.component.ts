import { Component, inject, input, output, signal } from '@angular/core';
import { I18n } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/t.pipe';
import { AvatarPreset, USER_AVATAR_PRESETS } from './avatar-presets';
import { AvatarComponent } from './avatar.component';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Subir foto, elegir un avatar predefinido o usar iniciales.
 * Valida tipo y tamaño antes de subir para no gastar datos en un archivo que la API rechazará.
 */
@Component({
  selector: 'oh-avatar-picker',
  imports: [TPipe, AvatarComponent],
  template: `
    <div class="current">
      <oh-avatar [name]="name()" [url]="url()" [presetId]="presetId()" [presets]="presets()" [size]="72" />
      <div class="upload">
        <label class="oh-btn oh-btn--tonal" [class.disabled]="busy()">
          {{ (busy() ? 'profile.photo.uploading' : 'profile.photo.upload') | t }}
          <input
            type="file"
            class="oh-sr-only"
            accept="image/png,image/jpeg,image/webp"
            (change)="onFile($event)"
            [disabled]="busy()"
          />
        </label>
        <span class="oh-hint">{{ 'profile.photo.hint' | t }}</span>
      </div>
    </div>
    @if (fileError(); as err) {
      <p class="oh-error" role="alert">{{ err }}</p>
    }
    <p class="oh-hint">{{ 'profile.photo.orPick' | t }}</p>
    <div class="presets" role="radiogroup" [attr.aria-label]="'profile.photo.orPick' | t">
      @for (preset of presets(); track preset.id) {
        <button
          type="button"
          role="radio"
          class="preset"
          [attr.aria-checked]="!url() && presetId() === preset.id"
          [attr.aria-label]="preset.id"
          [disabled]="busy()"
          (click)="pick.emit(preset.id)"
        >
          <oh-avatar [name]="preset.id" [presetId]="preset.id" [presets]="presets()" [size]="44" />
        </button>
      }
      <button
        type="button"
        role="radio"
        class="preset"
        [attr.aria-checked]="!url() && !presetId()"
        [attr.aria-label]="'profile.photo.useInitials' | t"
        [title]="'profile.photo.useInitials' | t"
        [disabled]="busy()"
        (click)="pick.emit(null)"
      >
        <oh-avatar [name]="name()" [size]="44" />
      </button>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 14px;
    }
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
export class AvatarPickerComponent {
  private readonly i18n = inject(I18n);
  readonly name = input.required<string>();
  readonly url = input<string | null>(null);
  readonly presetId = input<string | null>(null);
  readonly presets = input<AvatarPreset[]>(USER_AVATAR_PRESETS);
  readonly busy = input(false);
  readonly upload = output<File>();
  readonly pick = output<string | null>();
  protected readonly fileError = signal<string | null>(null);

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.fileError.set(null);
    if (!file) return;
    if (!TYPES.includes(file.type)) return this.fileError.set(this.i18n.error('FILE_TYPE_NOT_ALLOWED'));
    if (file.size > MAX_BYTES) return this.fileError.set(this.i18n.error('FILE_TOO_LARGE'));
    this.upload.emit(file);
  }
}
