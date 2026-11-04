import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService, browserTimezone } from '../../core/auth/auth.service';
import { I18n, Locale } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ProfileService } from './profile.service';

type NicknameState = 'idle' | 'checking' | 'available' | 'taken';

const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

@Component({
  selector: 'oh-profile-details',
  imports: [ReactiveFormsModule, TPipe],
  styleUrl: './profile-section.scss',
  template: `
    <h2>{{ 'profile.details.title' | t }}</h2>
    <form class="section-body oh-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="two">
        <div class="oh-field">
          <label for="firstName">{{ 'profile.details.firstName' | t }}</label>
          <input id="firstName" class="oh-input" formControlName="firstName" autocomplete="given-name" />
        </div>
        <div class="oh-field">
          <label for="lastName">{{ 'profile.details.lastName' | t }}</label>
          <input id="lastName" class="oh-input" formControlName="lastName" autocomplete="family-name" />
        </div>
      </div>

      <div class="oh-field">
        <label for="profile-nickname">{{ 'profile.details.nickname' | t }}</label>
        <input
          id="profile-nickname"
          class="oh-input"
          formControlName="nickname"
          autocapitalize="none"
          spellcheck="false"
          [attr.aria-invalid]="nicknameState() === 'taken' || form.controls.nickname.invalid || null"
          aria-describedby="profile-nickname-msg"
        />
        <span id="profile-nickname-msg" aria-live="polite">
          @switch (nicknameState()) {
            @case ('checking') {
              <span class="oh-hint">{{ 'auth.register.nicknameChecking' | t }}</span>
            }
            @case ('available') {
              <span class="oh-ok">✓ {{ 'auth.register.nicknameAvailable' | t }}</span>
            }
            @case ('taken') {
              <span class="oh-error">{{ 'errors.NICKNAME_TAKEN' | t }}</span>
            }
            @default {
              @if (form.controls.nickname.invalid) {
                <span class="oh-error">{{ 'errors.NICKNAME_INVALID' | t }}</span>
              }
            }
          }
        </span>
      </div>

      <div class="two">
        <div class="oh-field">
          <label for="locale">{{ 'profile.details.language' | t }}</label>
          <select id="locale" class="oh-input" formControlName="locale">
            <option value="es" lang="es">Español</option>
            <option value="en" lang="en">English</option>
          </select>
        </div>
        <div class="oh-field">
          <label for="timezone">{{ 'profile.details.timezone' | t }}</label>
          <select id="timezone" class="oh-input" formControlName="timezone">
            @for (tz of timezones; track tz) {
              <option [value]="tz">{{ tz.replaceAll('_', ' ') }}</option>
            }
          </select>
          @if (form.controls.timezone.value !== deviceTimezone) {
            <button type="button" class="oh-btn oh-btn--text detect" (click)="form.controls.timezone.setValue(deviceTimezone)">
              {{ 'profile.details.detect' | t }} ({{ deviceTimezone.replaceAll('_', ' ') }})
            </button>
          }
        </div>
      </div>

      <div aria-live="polite">
        @if (message(); as msg) {
          <p class="oh-alert" [class.is-error]="isError()" [class.is-success]="!isError()">{{ msg }}</p>
        }
      </div>

      <div class="actions">
        <button
          class="oh-btn oh-btn--filled"
          type="submit"
          [disabled]="form.invalid || form.pristine || nicknameState() === 'taken' || busy()"
        >
          {{ 'profile.details.save' | t }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .detect {
      justify-self: start;
      margin-left: -12px;
      min-height: 36px;
      font-size: 0.875rem;
    }
  `,
})
export class ProfileDetailsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly timezones = TIMEZONES;
  protected readonly deviceTimezone = browserTimezone();
  protected readonly form = inject(FormBuilder).nonNullable.group({
    firstName: ['', Validators.maxLength(60)],
    lastName: ['', Validators.maxLength(60)],
    nickname: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(30), Validators.pattern(/^[\p{L}\p{N}_.-]+$/u)]],
    locale: ['es' as Locale],
    timezone: ['UTC'],
  });
  protected readonly nicknameState = signal<NicknameState>('idle');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);

  ngOnInit(): void {
    this.reset();
    const nickname = this.form.controls.nickname;
    nickname.valueChanges
      .pipe(
        map((v) => v.trim()),
        distinctUntilChanged(),
        tap(() => this.nicknameState.set('idle')),
        debounceTime(400),
        switchMap((value) => {
          // El apodo propio (aunque cambie mayúsculas) no se consulta
          if (!nickname.valid || value.toLowerCase() === this.auth.user()?.nickname.toLowerCase()) return of<NicknameState>('idle');
          this.nicknameState.set('checking');
          return this.auth.isNicknameAvailable(value).pipe(
            map((r) => (r.available ? 'available' : 'taken') as NicknameState),
            catchError(() => of<NicknameState>('idle')),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.nicknameState.set(state));
  }

  private reset(): void {
    const user = this.auth.user();
    if (!user) return;
    this.form.reset({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      nickname: user.nickname,
      locale: user.locale,
      timezone: TIMEZONES.includes(user.timezone) ? user.timezone : 'UTC',
    });
  }

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const v = this.form.getRawValue();
      await this.profile.update({ ...v, firstName: v.firstName.trim(), lastName: v.lastName.trim(), nickname: v.nickname.trim() });
      this.reset();
      this.nicknameState.set('idle');
      this.isError.set(false);
      // Se traduce después de guardar: si cambió el idioma, el aviso ya sale en el nuevo
      this.message.set(this.i18n.t('profile.details.saved'));
    } catch (err) {
      const error = toApiError(err);
      if (error.code === 'NICKNAME_TAKEN') this.nicknameState.set('taken');
      this.isError.set(true);
      this.message.set(this.i18n.error(error.code === 'VALIDATION' ? Object.values(error.fields)[0] : error.code));
    } finally {
      this.busy.set(false);
    }
  }
}
