import { Component, computed, input } from '@angular/core';
import { AvatarPreset, findPreset, USER_AVATAR_PRESETS } from './avatar-presets';

/**
 * Muestra, en este orden: la foto subida, el avatar predefinido o las iniciales.
 * Sirve para usuarios y para grupos familiares (cambiando la lista de presets).
 */
@Component({
  selector: 'oh-avatar',
  template: `
    @if (url()) {
      <img [src]="url()" alt="" />
    } @else if (preset(); as p) {
      <span class="preset" [style.background]="p.tint">{{ p.emoji }}</span>
    } @else {
      <span class="initials">{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-grid;
      flex: none;
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      overflow: hidden;
      font-size: calc(var(--size) * 0.42);
    }
    img,
    span {
      width: 100%;
      height: 100%;
    }
    img {
      object-fit: cover;
    }
    span {
      display: grid;
      place-items: center;
    }
    .preset {
      font-size: calc(var(--size) * 0.56);
    }
    .initials {
      background: var(--oh-secondary-soft);
      color: var(--oh-secondary);
      font-weight: 700;
      letter-spacing: 0.02em;
    }
  `,
  host: { '[style.--size.px]': 'size()', role: 'img', '[attr.aria-label]': 'name()' },
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly url = input<string | null>(null);
  readonly presetId = input<string | null>(null);
  readonly presets = input<AvatarPreset[]>(USER_AVATAR_PRESETS);
  readonly size = input(40);

  protected readonly preset = computed(() => findPreset(this.presetId(), this.presets()));
  protected readonly initials = computed(() =>
    this.name()
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );
}
