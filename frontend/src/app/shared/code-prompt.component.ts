import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../core/api/api-error';
import { AuthService } from '../core/auth/auth.service';
import { I18n } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/t.pipe';

/**
 * Pide un código de 6 dígitos al correo y lo entrega a la pantalla que lo usa (que lo verifica en la API).
 * Muestra la cuenta regresiva para reenviar.
 */
@Component({
  selector: 'oh-code-prompt',
  imports: [TPipe],
  template: `
    <div class="prompt">
      <p class="lead">🔒 {{ message() }}</p>
      @if (!sent()) {
        <button type="button" class="oh-btn oh-btn--filled" (click)="send()" [disabled]="sending()">
          {{ 'code.send' | t: { email: email() } }}
        </button>
      } @else {
        <form (submit)="$event.preventDefault(); submit()" class="enter">
          <label for="code-input">{{ 'code.label' | t: { email: email() } }}</label>
          <div class="row">
            <input
              id="code-input"
              class="oh-input code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="000000"
              [value]="code()"
              (input)="onInput($event)"
            />
            <button type="submit" class="oh-btn oh-btn--filled" [disabled]="code().length !== 6 || busy()">{{ confirmLabel() }}</button>
          </div>
          <button type="button" class="oh-btn oh-btn--text resend" (click)="send()" [disabled]="wait() > 0 || sending()">
            {{ wait() > 0 ? ('code.resendIn' | t: { s: wait() }) : ('code.resend' | t) }}
          </button>
        </form>
      }
      @if (error() || ownError(); as err) {
        <p class="oh-alert is-error" role="alert">{{ err }}</p>
      }
    </div>
  `,
  styles: `
    .prompt {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: var(--oh-radius-lg);
      border: 1px solid var(--oh-border);
      background: var(--oh-surface);
    }
    .lead {
      line-height: 1.5;
    }
    .enter {
      display: grid;
      gap: 8px;
    }
    label {
      font-weight: 600;
      font-size: 0.9375rem;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .code {
      max-width: 180px;
      font-size: 1.25rem;
      letter-spacing: 0.3em;
      text-align: center;
    }
    .resend {
      justify-self: start;
      font-size: 0.875rem;
    }
  `,
})
export class CodePromptComponent {
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly busy = input(false);
  /** Error de la verificación (lo pone la pantalla que usa el código) */
  readonly error = input<string | null>(null);
  readonly submitted = output<string>();

  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);
  private readonly auth = inject(AuthService);
  protected readonly email = () => this.auth.user()?.email ?? '';
  protected readonly sent = signal(false);
  protected readonly sending = signal(false);
  protected readonly code = signal('');
  protected readonly wait = signal(0);
  protected readonly ownError = signal<string | null>(null);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  private countdown(seconds: number): void {
    clearInterval(this.timer);
    this.wait.set(seconds);
    this.timer = setInterval(() => {
      this.wait.update((s) => Math.max(0, s - 1));
      if (this.wait() === 0) clearInterval(this.timer);
    }, 1000);
  }

  async send(): Promise<void> {
    this.sending.set(true);
    this.ownError.set(null);
    try {
      const res = await firstValueFrom(this.http.post<{ resendIn: number }>('/api/me/verification-codes', { purpose: 'secrets' }));
      this.sent.set(true);
      this.code.set('');
      this.countdown(res.resendIn);
      setTimeout(() => document.getElementById('code-input')?.focus());
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'CODE_COOLDOWN') {
        this.sent.set(true);
        this.countdown(Number(e.details['retryIn'] ?? 60));
      } else {
        this.ownError.set(this.i18n.error(e.code, e.details));
      }
    } finally {
      this.sending.set(false);
    }
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    (event.target as HTMLInputElement).value = value;
    this.code.set(value);
    if (value.length === 6 && !this.busy()) this.submit();
  }

  submit(): void {
    if (this.code().length === 6) this.submitted.emit(this.code());
  }
}
