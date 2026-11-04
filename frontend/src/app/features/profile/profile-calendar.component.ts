import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ConfirmService } from '../../shared/confirm.service';
import { GoogleCalendarService } from '../calendar/google-calendar.service';

/** Perfil > Google Calendar: conectar, ver con qué cuenta y desconectar. */
@Component({
  selector: 'oh-profile-calendar',
  imports: [TPipe],
  styleUrl: './profile-section.scss',
  host: { id: 'calendario' },
  template: `
    <h2>{{ 'profile.calendar.title' | t }}</h2>
    <div class="section-body">
      @if (status(); as s) {
        @if (!s.available) {
          <p class="oh-muted">{{ 'profile.calendar.unavailable' | t }}</p>
        } @else if (s.connected) {
          <p>{{ 'profile.calendar.connectedAs' | t: { email: s.email ?? '', calendar: s.calendarName } }}</p>
          <p class="oh-hint">{{ 'profile.calendar.how' | t }}</p>
          <div class="actions">
            <button type="button" class="oh-btn oh-btn--outline" (click)="disconnect()" [disabled]="busy()">{{ 'profile.calendar.disconnect' | t }}</button>
          </div>
        } @else {
          <p class="oh-muted">{{ 'profile.calendar.body' | t }}</p>
          <p class="oh-hint">{{ 'profile.calendar.warning' | t }}</p>
          <div class="actions">
            <button type="button" class="oh-btn oh-btn--filled" (click)="connect()" [disabled]="busy()">{{ 'profile.calendar.connect' | t }}</button>
          </div>
        }
      } @else {
        <p class="oh-muted" role="status">{{ 'common.loading' | t }}</p>
      }
      @if (message(); as msg) {
        <p class="oh-alert" [class.is-error]="msg.error" [class.is-success]="!msg.error" role="status">{{ msg.text }}</p>
      }
    </div>
  `,
})
export class ProfileCalendarComponent implements OnInit {
  private readonly calendar = inject(GoogleCalendarService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  protected readonly status = computed(() => this.calendar.status());
  protected readonly busy = signal(false);
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);

  async ngOnInit(): Promise<void> {
    // Vuelta desde Google: ?google=connected | cancelled | error
    const result = this.route.snapshot.queryParamMap.get('google');
    await this.calendar.load(!!result);
    if (result) {
      const key = result === 'connected' ? 'profile.calendar.connected' : result === 'cancelled' ? 'profile.calendar.cancelled' : 'profile.calendar.failed';
      this.message.set({ text: this.i18n.t(key), error: result !== 'connected' });
      void this.router.navigate([], { queryParams: { google: null }, queryParamsHandling: 'merge', replaceUrl: true, fragment: 'calendario' });
      setTimeout(() => document.getElementById('calendario')?.scrollIntoView({ behavior: 'smooth' }));
    }
  }

  async connect(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await this.calendar.connect();
    } catch (err) {
      this.message.set({ text: this.i18n.error(toApiError(err).code), error: true });
      this.busy.set(false);
    }
  }

  async disconnect(): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('profile.calendar.disconnectTitle'),
      message: this.i18n.t('profile.calendar.disconnectBody'),
      confirmLabel: this.i18n.t('profile.calendar.disconnect'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.calendar.disconnect();
      this.message.set({ text: this.i18n.t('profile.calendar.disconnected'), error: false });
    } catch (err) {
      this.message.set({ text: this.i18n.error(toApiError(err).code), error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
