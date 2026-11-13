import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { AvatarComponent } from '../../shared/avatar.component';
import { AppearancePage } from '../appearance/appearance.page';
import { ProfileDetailsComponent } from '../profile/profile-details.component';
import { ProfileNotificationsComponent } from '../profile/profile-notifications.component';
import { ProfilePhotoComponent } from '../profile/profile-photo.component';
import { PracticeBannerComponent } from './practice-banner.component';
import { TourDefinition, TutorialService } from './tutorial.service';

type Section = 'appearance' | 'profile';

/**
 * Práctica del tutorial de la cuenta: Apariencia y parte del Perfil (foto, datos, avisos), las
 * pantallas de siempre. Los cambios se ven en toda la app mientras dura la práctica, pero se
 * responden en memoria (ver practiceInterceptor) y al salir la cuenta vuelve a como estaba.
 */
@Component({
  selector: 'oh-account-practice-page',
  imports: [
    TPipe,
    AvatarComponent,
    PracticeBannerComponent,
    AppearancePage,
    ProfilePhotoComponent,
    ProfileDetailsComponent,
    ProfileNotificationsComponent,
  ],
  template: `
    <oh-practice-banner />
    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        [attr.aria-selected]="section() === 'appearance'"
        (click)="section.set('appearance')"
      >
        🎨 {{ 'shell.appearance' | t }}
      </button>
      <button
        type="button"
        role="tab"
        data-tour="profile-tab"
        [attr.aria-selected]="section() === 'profile'"
        (click)="section.set('profile')"
      >
        👤 {{ 'shell.profile' | t }}
      </button>
    </div>
    @if (section() === 'appearance') {
      <oh-appearance-page />
    } @else {
      @if (auth.user(); as user) {
        <header class="who">
          <oh-avatar
            [name]="user.nickname"
            [url]="user.avatarUrl"
            [presetId]="user.avatarPreset"
            [size]="64"
          />
          <p class="name">
            {{ user.firstName ? user.firstName + ' ' + (user.lastName ?? '') : user.nickname }}
          </p>
        </header>
      }
      <oh-profile-photo />
      <oh-profile-details />
      <oh-profile-notifications />
    }
  `,
  styles: `
    .tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 20px;
      border-radius: 999px;
      border: 1px solid var(--oh-border);
      background: var(--oh-surface);
    }
    .tabs button {
      min-height: 36px;
      padding: 0 16px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--oh-text-muted);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .tabs button[aria-selected='true'] {
      background: var(--oh-primary);
      color: var(--oh-on-primary);
    }
    .who {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 24px;
    }
    .name {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
    }
  `,
})
export class AccountPracticePage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly tutorial = inject(TutorialService);
  protected readonly section = signal<Section>('appearance');

  /** La cuenta al empezar, para notar lo que cambió en cada paso */
  private readonly initial = this.auth.user();
  private readonly show = (section: Section) => () => this.section.set(section);

  private readonly definition: TourDefinition = {
    id: 'account',
    steps: [
      {
        id: 'season',
        target: '[data-tour="seasonal"]',
        title: 'tutorial.account.season.title',
        body: 'tutorial.account.season.body',
        until: () =>
          !!document.querySelector('[data-tour="seasonal"] .preset[aria-checked="true"]'),
        ensure: this.show('appearance'),
      },
      {
        id: 'pattern',
        target: '[data-tour="patterns"]',
        title: 'tutorial.account.pattern.title',
        body: 'tutorial.account.pattern.body',
        ensure: this.show('appearance'),
      },
      {
        id: 'save',
        target: '[data-tour="save"]',
        title: 'tutorial.account.save.title',
        body: 'tutorial.account.save.body',
        until: () =>
          JSON.stringify(this.auth.user()?.theme ?? null) !==
          JSON.stringify(this.initial?.theme ?? null),
        ensure: this.show('appearance'),
      },
      {
        id: 'photo',
        target: 'oh-profile-photo',
        title: 'tutorial.account.photo.title',
        body: 'tutorial.account.photo.body',
        ensure: this.show('profile'),
      },
      {
        id: 'details',
        target: 'oh-profile-details',
        title: 'tutorial.account.details.title',
        body: 'tutorial.account.details.body',
        ensure: this.show('profile'),
      },
    ],
    extras: [
      {
        id: 'auto',
        title: 'tutorial.account.extras.auto',
        steps: [
          {
            id: 'auto-on',
            target: '[data-tour="auto"]',
            title: 'tutorial.account.auto.title',
            body: 'tutorial.account.auto.body',
            until: () =>
              !!(document.querySelector('[data-tour="auto"] input') as HTMLInputElement | null)
                ?.checked,
            ensure: this.show('appearance'),
          },
          {
            id: 'auto-save',
            target: '[data-tour="save"]',
            title: 'tutorial.account.autoSave.title',
            body: 'tutorial.account.autoSave.body',
            until: () => !!this.auth.user()?.theme?.auto?.enabled,
            ensure: this.show('appearance'),
          },
        ],
      },
      {
        id: 'notifications',
        title: 'tutorial.account.extras.notifications',
        steps: [
          {
            id: 'notifications',
            target: 'oh-profile-notifications',
            title: 'tutorial.account.notifications.title',
            body: 'tutorial.account.notifications.body',
            ensure: this.show('profile'),
          },
        ],
      },
    ],
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.tutorial.detach(this.definition));
  }

  ngOnInit(): void {
    this.tutorial.attach(this.definition);
  }
}
