import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { AvatarComponent } from '../../shared/avatar.component';
import { ProfileDetailsComponent } from './profile-details.component';
import { ProfileEmailComponent } from './profile-email.component';
import { ProfilePasswordComponent } from './profile-password.component';
import { ProfilePhotoComponent } from './profile-photo.component';
import { ProfileSecurityComponent } from './profile-security.component';

@Component({
  selector: 'oh-profile-page',
  imports: [
    TPipe,
    AvatarComponent,
    ProfilePhotoComponent,
    ProfileDetailsComponent,
    ProfileEmailComponent,
    ProfilePasswordComponent,
    ProfileSecurityComponent,
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
      </header>
    }
    <oh-profile-photo />
    <oh-profile-details />
    <oh-profile-email />
    <oh-profile-password />
    <oh-profile-security />
  `,
  styles: `
    .who {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 28px;
    }
    .name {
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .oh-muted {
      overflow-wrap: anywhere;
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
}
