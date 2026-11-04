import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';

/** Destino del enlace del correo de confirmación. Si sale bien, deja la sesión iniciada. */
@Component({
  selector: 'oh-verify-email-page',
  imports: [RouterLink, TPipe],
  styleUrl: './auth-page.scss',
  template: `
    @if (error(); as err) {
      <h1>{{ 'auth.verify.failedTitle' | t }}</h1>
      <p class="lead">{{ err }} {{ 'auth.verify.askNew' | t }}</p>
      <a class="oh-btn oh-btn--filled" routerLink="/ingresar">{{ 'auth.verify.goLogin' | t }}</a>
    } @else {
      <p class="lead" role="status">{{ 'auth.verify.verifying' | t }}</p>
    }
  `,
})
export class VerifyEmailPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18n);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.error.set(this.i18n.error('TOKEN_INVALID'));
      return;
    }
    try {
      await this.auth.verifyEmail(token);
      await this.router.navigateByUrl('/inicio', { replaceUrl: true });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }
}
