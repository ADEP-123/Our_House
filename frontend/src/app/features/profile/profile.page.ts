import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { AvatarComponent } from '../../shared/avatar.component';
import { ProfileCalendarComponent } from './profile-calendar.component';
import { ProfileDetailsComponent } from './profile-details.component';
import { ProfileEmailComponent } from './profile-email.component';
import { ProfileNotificationsComponent } from './profile-notifications.component';
import { ProfilePasswordComponent } from './profile-password.component';
import { ProfilePhotoComponent } from './profile-photo.component';
import { ProfileSecurityComponent } from './profile-security.component';
import { TutorialButtonComponent } from '../tutorial/tutorial-button.component';
import { TutorialService } from '../tutorial/tutorial.service';

@Component({
  selector: 'oh-profile-page',
  imports: [
    RouterLink,
    TPipe,
    AvatarComponent,
    ProfilePhotoComponent,
    ProfileDetailsComponent,
    ProfileEmailComponent,
    ProfilePasswordComponent,
    ProfileNotificationsComponent,
    ProfileCalendarComponent,
    ProfileSecurityComponent,
    TutorialButtonComponent,
  ],
  template: `
    <h1 class="oh-sr-only">{{ 'profile.title' | t }}</h1>
    @if (auth.user(); as user) {
      <header class="who">
        <oh-avatar [name]="user.nickname" [url]="user.avatarUrl" [presetId]="user.avatarPreset" [size]="64" />
        <div>
          <p class="name">{{ user.firstName ? user.firstName + ' ' + (user.lastName ?? '') : user.nickname }}</p>
          <p class="oh-muted">&#64;{{ user.nickname }} · {{ user.email }}</p>
        </div>
        <oh-tutorial-button tutorial="account" class="help" />
      </header>
    }
    <oh-profile-photo />
    <oh-profile-details />
    <oh-profile-email />
    <oh-profile-password />
    <oh-profile-notifications />
    <oh-profile-calendar />
    <oh-profile-security />
    <p class="legal">
      <a routerLink="/privacidad">{{ 'legal.privacy' | t }}</a>
      <a routerLink="/terminos">{{ 'legal.terms' | t }}</a>
    </p>
  `,
  styles: `
    .who {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 28px;
    }
    .help {
      margin-left: auto;
    }
    .name {
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .oh-muted {
      overflow-wrap: anywhere;
    }
    .legal {
      display: flex;
      gap: 20px;
      padding-top: 24px;
      border-top: 1px solid var(--oh-border);
      font-size: 0.875rem;
    }
    .legal a {
      color: var(--oh-text-muted);
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);

  constructor() {
    // Primera vez en Perfil: invita al tutorial de la cuenta
    inject(TutorialService).offer('account');
  }
}
