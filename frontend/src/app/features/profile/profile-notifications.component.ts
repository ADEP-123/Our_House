import { Component, computed, inject, signal } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { AuthService, ReminderDefaults, UserNotifications } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ProfileService } from './profile.service';

const OPTIONS: { key: keyof UserNotifications; label: TranslationKey; hint: TranslationKey }[] = [
  { key: 'newLists', label: 'profile.notifications.newLists', hint: 'profile.notifications.newListsHint' },
  { key: 'assignments', label: 'profile.notifications.assignments', hint: 'profile.notifications.assignmentsHint' },
  { key: 'reminders', label: 'profile.notifications.reminders', hint: 'profile.notifications.remindersHint' },
  { key: 'secretViews', label: 'profile.notifications.secretViews', hint: 'profile.notifications.secretViewsHint' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

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

      @if (settings().reminders) {
        <!-- Valores por defecto de los recordatorios; cada tarea puede cambiarlos -->
        <form class="reminders" (submit)="$event.preventDefault(); saveReminders()">
          <p class="oh-muted">{{ 'profile.notifications.remindersBody' | t }}</p>
          <div class="fields">
            <div class="oh-field">
              <label for="reminder-start">{{ 'profile.notifications.startDays' | t }}</label>
              <input id="reminder-start" class="oh-input" type="number" min="0" max="60" [value]="draft().startDays" (input)="setDraft('startDays', $event)" />
            </div>
            <div class="oh-field">
              <label for="reminder-every">{{ 'profile.notifications.everyDays' | t }}</label>
              <input id="reminder-every" class="oh-input" type="number" min="1" max="30" [value]="draft().everyDays" (input)="setDraft('everyDays', $event)" />
            </div>
            <div class="oh-field">
              <label for="reminder-hour">{{ 'profile.notifications.hour' | t }}</label>
              <select id="reminder-hour" class="oh-input" [value]="draft().hour" (change)="setDraft('hour', $event)">
                @for (h of hours; track h) {
                  <option [value]="h" [selected]="h === draft().hour">{{ hourLabel(h) }}</option>
                }
              </select>
            </div>
          </div>
          <p class="oh-hint">{{ 'profile.notifications.remindersExample' | t: example() }}</p>
          <div class="actions">
            <button type="submit" class="oh-btn oh-btn--filled" [disabled]="!draftValid() || !draftChanged() || busy() === 'reminderDefaults'">
              {{ 'profile.notifications.saveReminders' | t }}
            </button>
          </div>
        </form>
      }

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
    .reminders {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--oh-primary) 6%, var(--oh-surface));
    }
    .fields {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
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
  protected readonly hours = HOURS;
  // Una sesión guardada antes de esta versión no trae preferencias: por defecto todo activado
  protected readonly settings = computed<UserNotifications>(() => ({
    newLists: true,
    assignments: true,
    reminders: true,
    secretViews: true,
    ...this.auth.user()?.notifications,
  }));
  private readonly saved = computed<ReminderDefaults>(() => ({ hour: 8, startDays: 3, everyDays: 1, ...this.auth.user()?.reminders }));
  /** Lo que se está editando de los recordatorios (se guarda con el botón) */
  private readonly edits = signal<Partial<ReminderDefaults>>({});
  protected readonly draft = computed<ReminderDefaults>(() => ({ ...this.saved(), ...this.edits() }));
  protected readonly draftValid = computed(() => {
    const d = this.draft();
    return Number.isInteger(d.startDays) && d.startDays >= 0 && d.startDays <= 60 && Number.isInteger(d.everyDays) && d.everyDays >= 1 && d.everyDays <= 30;
  });
  protected readonly draftChanged = computed(() => {
    const d = this.draft();
    const s = this.saved();
    return d.hour !== s.hour || d.startDays !== s.startDays || d.everyDays !== s.everyDays;
  });
  protected readonly example = computed(() => {
    const d = this.draft();
    return { start: d.startDays, every: d.everyDays, hour: this.hourLabel(d.hour) };
  });
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);

  protected hourLabel(hour: number): string {
    return new Date(2000, 0, 1, hour).toLocaleTimeString(this.i18n.locale(), { hour: 'numeric', minute: '2-digit' });
  }

  protected setDraft(key: keyof ReminderDefaults, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.edits.update((e) => ({ ...e, [key]: value }));
  }

  async saveReminders(): Promise<void> {
    if (!this.draftValid()) return;
    const d = this.draft();
    this.busy.set('reminderDefaults');
    this.message.set(null);
    try {
      await this.profile.setSettings({ reminderHour: d.hour, reminderStartDays: d.startDays, reminderEveryDays: d.everyDays });
      this.edits.set({});
      this.message.set({ text: this.i18n.t('profile.notifications.saved'), error: false });
    } catch (err) {
      this.message.set({ text: this.i18n.error(toApiError(err).code), error: true });
    } finally {
      this.busy.set(null);
    }
  }

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
