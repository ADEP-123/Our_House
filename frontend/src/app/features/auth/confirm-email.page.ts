import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ProfileService } from '../profile/profile.service';

/** Destino del enlace enviado al correo nuevo. Funciona aunque se abra en otro dispositivo sin sesión. */
@Component({
  selector: 'oh-confirm-email-page',
  imports: [RouterLink, TPipe],
  styleUrl: './auth-page.scss',
  template: `
    @switch (state()) {
      @case ('working') {
        <p class="lead" role="status">{{ 'confirmEmail.working' | t }}</p>
      }
      @case ('done') {
        <p class="oh-alert is-success" role="status">{{ 'confirmEmail.done' | t }}</p>
        <p class="links"><a class="oh-btn oh-btn--filled" routerLink="/inicio">{{ 'confirmEmail.goApp' | t }}</a></p>
      }
      @default {
        <h1>{{ 'confirmEmail.failedTitle' | t }}</h1>
        <p class="lead">{{ error() }} {{ 'confirmEmail.retry' | t }}</p>
        <a class="oh-btn oh-btn--filled" routerLink="/perfil">{{ 'confirmEmail.goApp' | t }}</a>
      }
    }
  `,
})
export class ConfirmEmailPage implements OnInit {
  private readonly profile = inject(ProfileService);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  protected readonly state = signal<'working' | 'done' | 'failed'>('working');
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    try {
      if (!this.token) throw new Error('sin token');
      await this.profile.confirmEmailChange(this.token);
      // Si hay sesión en este dispositivo, trae el correo nuevo
      await this.auth.reload();
      this.state.set('done');
    } catch (err) {
      this.error.set(this.i18n.error(this.token ? toApiError(err).code : 'TOKEN_INVALID'));
      this.state.set('failed');
    }
  }
}
