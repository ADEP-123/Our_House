import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { PracticeBannerComponent } from './practice-banner.component';
import { TourDefinition, TutorialService } from './tutorial.service';

interface PracticeTask {
  id: string;
  text: string;
  date: string;
  time: string | null;
  repeatWeekly: boolean;
  done: boolean;
}

interface PracticeEvent {
  taskId: string;
  text: string;
  date: string;
  time: string | null;
  done: boolean;
}

const isoIn = (days: number, from = new Date()) => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusWeek = (date: string) => isoIn(7, new Date(Date.parse(`${date}T12:00:00`)));

/**
 * Práctica del tutorial de Google Calendar. La conexión real pasa por Google, así que aquí se
 * simula: el botón, el permiso y un calendario de muestra que reacciona a las tareas.
 * Al final, "Conectar de verdad" lleva a Perfil.
 */
@Component({
  selector: 'oh-calendar-practice-page',
  imports: [TPipe, PracticeBannerComponent],
  template: `
    <oh-practice-banner />
    <h1>{{ 'profile.calendar.title' | t }}</h1>

    <section class="oh-panel card" data-tour="connect-card">
      @if (connected()) {
        <p>✅ {{ 'tutorial.calendar.connectedAs' | t: { email: email() } }}</p>
        <p class="oh-hint">{{ 'profile.calendar.how' | t }}</p>
      } @else if (consent()) {
        <div class="consent" data-tour="consent">
          <p class="sim">{{ 'tutorial.calendar.simulated' | t }}</p>
          <p>{{ 'tutorial.calendar.consent' | t }}</p>
          <div class="actions">
            <button type="button" class="oh-btn oh-btn--filled" data-tour="allow" (click)="allow()">
              {{ 'tutorial.calendar.allowButton' | t }}
            </button>
            <button type="button" class="oh-btn oh-btn--text" (click)="consent.set(false)">
              {{ 'lists.items.cancel' | t }}
            </button>
          </div>
        </div>
      } @else {
        <p class="oh-muted">{{ 'profile.calendar.body' | t }}</p>
        <div class="actions">
          <button
            type="button"
            class="oh-btn oh-btn--filled"
            data-tour="connect"
            (click)="consent.set(true)"
          >
            {{ 'profile.calendar.connect' | t }}
          </button>
        </div>
      }
    </section>

    <div class="grid">
      <section class="oh-panel" data-tour="tasks">
        <h2>{{ 'tutorial.calendar.tasksTitle' | t }}</h2>
        <ul class="tasks">
          @for (task of tasks(); track task.id) {
            <li [class.done]="task.done">
              <button
                type="button"
                class="check"
                [attr.data-tour]="'check-' + task.id"
                [attr.aria-pressed]="task.done"
                [attr.aria-label]="task.text"
                (click)="toggle(task)"
              >
                @if (task.done) {
                  ✓
                }
              </button>
              <span class="text">{{ task.text }}</span>
              <span class="tag">📅 {{ when(task.date, task.time) }}</span>
              @if (task.repeatWeekly) {
                <span class="tag">🔁 {{ 'lists.repeat.freq.weekly' | t }}</span>
              }
            </li>
          }
        </ul>
      </section>

      <section class="oh-panel" data-tour="calendar">
        <h2>{{ 'tutorial.calendar.calendarTitle' | t }}</h2>
        @if (!connected()) {
          <p class="oh-muted">{{ 'tutorial.calendar.notConnected' | t }}</p>
        } @else {
          <ol class="agenda">
            @for (day of agenda(); track day.date) {
              <li>
                <p class="day">{{ dayLabel(day.date) }}</p>
                @for (e of day.events; track $index) {
                  <p class="event" [class.done]="e.done">
                    <span>{{ e.done ? '✓ ' : '' }}{{ e.text }}</span>
                    <span class="time">{{ e.time ?? ('tutorial.calendar.allDay' | t) }}</span>
                  </p>
                }
              </li>
            }
          </ol>
        }
      </section>
    </div>
  `,
  styles: `
    h1 {
      margin: 0 0 16px;
    }
    h2 {
      font-size: 1rem;
      margin: 0 0 12px;
    }
    .card {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }
    .card p {
      margin: 0;
    }
    .consent {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: var(--oh-radius);
      border: 1px solid var(--oh-border);
      background: var(--oh-background);
    }
    .sim {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--oh-text-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .grid {
      display: grid;
      gap: 18px;
      @media (min-width: 900px) {
        grid-template-columns: 1fr 1fr;
        align-items: start;
      }
    }
    .tasks,
    .agenda {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }
    .tasks li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
    }
    .tasks li.done .text {
      text-decoration: line-through;
      color: var(--oh-text-muted);
    }
    .check {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid var(--oh-border-strong);
      background: var(--oh-surface);
      color: var(--oh-on-primary);
      font-weight: 800;
      cursor: pointer;
    }
    .check[aria-pressed='true'] {
      background: var(--oh-primary);
      border-color: var(--oh-primary);
    }
    .text {
      font-weight: 600;
    }
    .tag {
      font-size: 0.8125rem;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--oh-background);
      color: var(--oh-text-muted);
    }
    .day {
      margin: 0 0 4px;
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--oh-text-muted);
    }
    .day::first-letter {
      text-transform: uppercase;
    }
    /* Así se ve un evento en Google Calendar: un bloque de color con el título */
    .event {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 0 0 4px;
      padding: 6px 10px;
      border-radius: 8px;
      background: #3f51b5;
      color: #ffffff;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .event.done {
      opacity: 0.6;
    }
    .time {
      font-weight: 400;
    }
  `,
})
export class CalendarPracticePage implements OnInit {
  private readonly tutorial = inject(TutorialService);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  protected readonly consent = signal(false);
  protected readonly connected = signal(false);
  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  protected readonly tasks = signal<PracticeTask[]>([]);
  private readonly events = signal<PracticeEvent[]>([]);

  /** Los eventos por día, como la agenda del calendario */
  protected readonly agenda = computed(() => {
    const byDay = new Map<string, PracticeEvent[]>();
    for (const e of [...this.events()].sort((a, b) =>
      (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')),
    )) {
      byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    }
    return [...byDay.entries()].map(([date, events]) => ({ date, events }));
  });

  private readonly task = (id: string) => this.tasks().find((t) => t.id === id)!;

  private readonly definition: TourDefinition = {
    id: 'calendar',
    steps: [
      {
        id: 'intro',
        target: '[data-tour="connect-card"]',
        title: 'tutorial.calendar.intro.title',
        body: 'tutorial.calendar.intro.body',
        ensure: () => this.reset(false),
      },
      {
        id: 'connect',
        target: '[data-tour="connect"]',
        title: 'tutorial.calendar.connect.title',
        body: 'tutorial.calendar.connect.body',
        until: () => this.consent() || this.connected(),
        ensure: () => this.reset(false),
      },
      {
        id: 'allow',
        target: '[data-tour="allow"]',
        title: 'tutorial.calendar.allow.title',
        body: 'tutorial.calendar.allow.body',
        until: () => this.connected(),
        ensure: () => !this.connected() && this.consent.set(true),
      },
      {
        id: 'events',
        target: '[data-tour="calendar"]',
        title: 'tutorial.calendar.events.title',
        body: 'tutorial.calendar.events.body',
        ensure: () => this.ensureConnected(),
      },
      {
        id: 'complete',
        target: '[data-tour="check-bill"]',
        title: 'tutorial.calendar.complete.title',
        body: 'tutorial.calendar.complete.body',
        until: () => this.task('bill').done,
        ensure: () => this.ensureConnected(),
      },
    ],
    extras: [
      {
        id: 'repeat',
        title: 'tutorial.calendar.extras.repeat',
        steps: [
          {
            id: 'repeat',
            target: '[data-tour="check-plants"]',
            title: 'tutorial.calendar.repeat.title',
            body: 'tutorial.calendar.repeat.body',
            until: () => this.events().filter((e) => e.taskId === 'plants').length > 1,
            ensure: () => this.ensureConnected(),
          },
          {
            id: 'repeat-result',
            target: '[data-tour="calendar"]',
            title: 'tutorial.calendar.repeatResult.title',
            body: 'tutorial.calendar.repeatResult.body',
          },
        ],
      },
      {
        id: 'manage',
        title: 'tutorial.calendar.extras.manage',
        steps: [
          {
            id: 'manage',
            target: '[data-tour="connect-card"]',
            title: 'tutorial.calendar.manage.title',
            body: 'tutorial.calendar.manage.body',
            ensure: () => this.ensureConnected(),
          },
        ],
      },
    ],
    finalAction: {
      label: 'tutorial.calendar.connectForReal',
      run: () => void this.router.navigate(['/perfil'], { fragment: 'calendario' }),
    },
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.tutorial.detach(this.definition));
  }

  ngOnInit(): void {
    this.reset(false);
    this.tutorial.attach(this.definition);
  }

  /** Tareas de ejemplo: una con hora y una que se repite cada semana */
  private reset(connected: boolean): void {
    if (this.tasks().length && this.connected() === connected) return;
    this.tasks.set([
      {
        id: 'bill',
        text: this.i18n.t('tutorial.calendar.taskBill'),
        date: isoIn(2),
        time: '18:30',
        repeatWeekly: false,
        done: false,
      },
      {
        id: 'plants',
        text: this.i18n.t('tutorial.calendar.taskPlants'),
        date: isoIn(4),
        time: null,
        repeatWeekly: true,
        done: false,
      },
    ]);
    this.consent.set(false);
    this.connected.set(connected);
    this.events.set(connected ? this.tasks().map((t) => this.eventOf(t)) : []);
  }

  private ensureConnected(): void {
    if (!this.connected()) this.allow();
  }

  private eventOf(task: PracticeTask): PracticeEvent {
    return { taskId: task.id, text: task.text, date: task.date, time: task.time, done: task.done };
  }

  /** "Permitir": queda conectado y las tareas con fecha aparecen en el calendario */
  protected allow(): void {
    this.consent.set(false);
    this.connected.set(true);
    this.events.set(this.tasks().map((t) => this.eventOf(t)));
  }

  /** Marcar: el evento pasa a "✓"; si se repite, la tarea sigue a la próxima semana con otro evento */
  protected toggle(task: PracticeTask): void {
    const done = !task.done;
    if (done && task.repeatWeekly) {
      const next = { ...task, date: plusWeek(task.date) };
      this.tasks.update((all) => all.map((t) => (t.id === task.id ? next : t)));
      if (this.connected()) {
        this.events.update((all) => [
          ...all.map((e) =>
            e.taskId === task.id && e.date === task.date ? { ...e, done: true } : e,
          ),
          this.eventOf(next),
        ]);
      }
      return;
    }
    this.tasks.update((all) => all.map((t) => (t.id === task.id ? { ...t, done } : t)));
    this.events.update((all) =>
      all.map((e) => (e.taskId === task.id && e.date === task.date ? { ...e, done } : e)),
    );
  }

  protected when(date: string, time: string | null): string {
    const d = new Date(`${date}T${time ?? '12:00'}`);
    const day = d.toLocaleDateString(this.i18n.locale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    return time
      ? `${day} ${d.toLocaleTimeString(this.i18n.locale(), { hour: 'numeric', minute: '2-digit' })}`
      : day;
  }

  protected dayLabel(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }
}
