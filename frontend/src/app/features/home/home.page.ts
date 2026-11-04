import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FAMILY_AVATAR_PRESETS } from '../../shared/avatar-presets';
import { AvatarComponent } from '../../shared/avatar.component';
import { FamiliesService } from '../families/families.service';

@Component({
  selector: 'oh-home-page',
  imports: [RouterLink, TPipe, AvatarComponent],
  template: `
    <h1>{{ 'home.greeting' | t: { name: auth.user()?.firstName || auth.user()?.nickname || '' } }}</h1>
    <p class="intro">{{ 'home.intro' | t }}</p>

    @if (store.received().length) {
      <div class="oh-alert invites" role="status">
        <span>{{ 'home.pendingInvitations' | t: { n: store.received().length } }}</span>
        <a class="oh-btn oh-btn--filled" routerLink="/familias">{{ 'home.review' | t }}</a>
      </div>
    }

    @if (store.families(); as families) {
      @if (store.active(); as active) {
        <section class="oh-panel active">
          <p class="label">{{ 'home.activeGroup' | t }}</p>
          <div class="active-row">
            <oh-avatar [name]="active.name" [url]="active.avatarUrl" [presetId]="active.avatarPreset" [presets]="familyPresets" [size]="56" />
            <div class="active-text">
              <p class="active-name">{{ active.name }}</p>
              <p class="oh-muted">
                {{ active.memberCount === 1 ? ('families.oneMember' | t) : ('families.members' | t: { n: active.memberCount }) }}
              </p>
            </div>
          </div>
          <div class="actions">
            <a class="oh-btn oh-btn--tonal" [routerLink]="['/familias', active.id]">{{ 'home.manage' | t }}</a>
            @if (families.length > 1) {
              <label class="switch">
                <span class="oh-sr-only">{{ 'home.switchGroup' | t }}</span>
                <select class="oh-input" [value]="active.id" (change)="store.setActive($any($event.target).value)">
                  @for (f of families; track f.id) {
                    <option [value]="f.id">{{ f.name }}</option>
                  }
                </select>
              </label>
            }
          </div>
        </section>
      } @else {
        <section class="start">
          <p>{{ 'home.noFamily' | t }}</p>
          <a class="oh-btn oh-btn--filled" routerLink="/familias">{{ 'home.start' | t }}</a>
        </section>
      }
    }
  `,
  styles: `
    h1 {
      font-size: 2rem;
    }
    .intro {
      margin: 8px 0 28px;
      max-width: 60ch;
      color: var(--oh-text-muted);
    }
    .invites {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
      font-weight: 500;
    }
    .active {
      display: grid;
      gap: 16px;
      max-width: 560px;
    }
    .label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--oh-text-muted);
    }
    .active-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .active-name {
      font-size: 1.375rem;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .switch select {
      min-height: 44px;
    }
    .start {
      display: grid;
      gap: 16px;
      justify-items: start;
      max-width: 560px;
      padding: 28px;
      border: 1px dashed var(--oh-border-strong);
      border-radius: var(--oh-radius-lg);
    }
  `,
})
export class HomePage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(FamiliesService);
  protected readonly familyPresets = FAMILY_AVATAR_PRESETS;

  ngOnInit(): void {
    void this.store.load().catch(() => undefined);
  }
}
