import { Component, computed, inject, signal } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { AuthService, UserNotifications } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ProfileService } from './profile.service';

const OPTIONS: { key: keyof UserNotifications; label: TranslationKey; hint: TranslationKey }[] = [
  { key: 'newLists', label: 'profile.notifications.newLists', hint: 'profile.notifications.newListsHint' },
  { key: 'assignments', label: 'profile.notifications.assignments', hint: 'profile.notifications.assignmentsHint' },
];

/** Qué correos quiere recibir cada persona. Cada interruptor se guarda al cambiarlo. */
@Component({
  selector: 'oh-profile-notifications',
  imports: [TPipe],
  styleUrl: './profile-section.scss',
  host: { id: 'notificaciones' },
  template: `
    <h2>{{ 'profile.notifications.title' | t }}</h2>
    <div class="section-body">
      <p class="oh-muted">{{ 'profile.notifications.body' | t }}</p>
      <ul class="toggles">
        @for (option of options; track option.key) {
          <li>
            <label class="toggle">
              <span>
                <strong>{{ option.label | t }}</strong>
                <small>{{ option.hint | t }}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                [checked]="settings()[option.key]"
                [disabled]="busy() === option.key"
                (change)="save(option.key, $any($event.target).checked)"
              />
            </label>
          </li>
        }
      </ul>
      @if (message(); as msg) {
        <p class="oh-alert" [class.is-error]="msg.error" [class.is-success]="!msg.error" role="status">{{ msg.text }}</p>
      }
    </div>
  `,
  styles: `
    .toggles {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0;
      cursor: pointer;
    }
    small {
      display: block;
      color: var(--oh-text-muted);
      line-height: 1.4;
      margin-top: 2px;
    }
    input[role='switch'] {
      appearance: none;
      flex: none;
      width: 44px;
      height: 26px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--oh-text) 22%, transparent);
      position: relative;
      cursor: pointer;
      transition: background 0.15s;
    }
    input[role='switch']::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
      transition: transform 0.15s;
    }
    input[role='switch']:checked {
      background: var(--oh-primary);
    }
    input[role='switch']:checked::after {
      transform: translateX(18px);
    }
    input[role='switch']:focus-visible {
      outline: 2px solid var(--oh-primary);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      input[role='switch'],
      input[role='switch']::after {
        transition: none;
      }
    }
  `,
})
export class ProfileNotificationsComponent {
  private readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);

  protected readonly options = OPTIONS;
  // Una sesión guardada antes de esta versión no trae preferencias: por defecto todo activado
  protected readonly settings = computed<UserNotifications>(() => ({ newLists: true, assignments: true, ...this.auth.user()?.notifications }));
  protected readonly busy = signal<keyof UserNotifications | null>(null);
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);

  async save(key: keyof UserNotifications, value: boolean): Promise<void> {
    this.busy.set(key);
    this.message.set(null);
    try {
      await this.profile.setSettings({ [key]: value });
      this.message.set({ text: this.i18n.t('profile.notifications.saved'), error: false });
    } catch (err) {
      this.message.set({ text: this.i18n.error(toApiError(err).code), error: true });
    } finally {
      this.busy.set(null);
    }
  }
}
