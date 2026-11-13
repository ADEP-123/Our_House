import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { GoogleCalendarService } from '../calendar/google-calendar.service';
import { FamiliesService } from '../families/families.service';
import { ListsStore } from '../lists/lists.store';
import { TutorialService } from './tutorial.service';

interface Step {
  id: string;
  label: TranslationKey;
  done: boolean;
  link: string;
  fragment?: string;
}

/**
 * "Primeros pasos" en Inicio: crear la primera lista, elegir un tema y conectar el calendario.
 * Se marca solo con lo que ya hizo cada persona y desaparece al completarlo o al ocultarlo.
 */
@Component({
  selector: 'oh-getting-started',
  imports: [RouterLink, TPipe],
  template: `
    @if (visible()) {
      <section class="oh-panel card" aria-labelledby="getting-started-title">
        <div class="head">
          <h2 id="getting-started-title">🚀 {{ 'tutorial.gettingStarted.title' | t }}</h2>
          <span class="count">{{ doneCount() }}/{{ steps().length }}</span>
          <button type="button" class="oh-btn oh-btn--text" (click)="hide()">
            {{ 'tutorial.gettingStarted.hide' | t }}
          </button>
        </div>
        <ul>
          @for (step of steps(); track step.id) {
            <li [class.done]="step.done">
              <span class="mark" aria-hidden="true">{{ step.done ? '✓' : '' }}</span>
              <span class="label">{{ step.label | t }}</span>
              @if (step.done) {
                <span class="oh-sr-only">{{ 'tutorial.gettingStarted.done' | t }}</span>
              } @else {
                <a
                  class="oh-btn oh-btn--tonal go"
                  [routerLink]="step.link"
                  [fragment]="step.fragment"
                  >{{ 'tutorial.gettingStarted.go' | t }}</a
                >
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    .card {
      display: grid;
      gap: 12px;
      margin-top: 20px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    h2 {
      margin: 0;
      font-size: 1.0625rem;
    }
    .count {
      margin-right: auto;
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--oh-text-muted);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    li {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 40px;
    }
    .mark {
      display: grid;
      place-items: center;
      flex: none;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid var(--oh-border-strong);
      color: var(--oh-on-primary);
      font-size: 0.875rem;
      font-weight: 800;
    }
    li.done .mark {
      background: var(--oh-success);
      border-color: var(--oh-success);
    }
    li.done .label {
      color: var(--oh-text-muted);
      text-decoration: line-through;
    }
    .label {
      flex: 1;
      font-weight: 600;
    }
    .go {
      min-height: 34px;
    }
  `,
})
export class GettingStartedComponent {
  private readonly auth = inject(AuthService);
  private readonly families = inject(FamiliesService);
  private readonly lists = inject(ListsStore);
  private readonly calendar = inject(GoogleCalendarService);
  private readonly tutorial = inject(TutorialService);

  /** ¿Ya creó alguna lista en su grupo activo? */
  private readonly hasList = signal<boolean | null>(null);

  protected readonly steps = computed<Step[]>(() => {
    const user = this.auth.user();
    const calendar = this.calendar.status();
    const steps: Step[] = [
      {
        id: 'lists',
        label: 'tutorial.gettingStarted.lists',
        done: !!this.hasList(),
        link: '/listas/nueva',
      },
      {
        id: 'theme',
        label: 'tutorial.gettingStarted.theme',
        done: !!user?.theme,
        link: '/apariencia',
      },
    ];
    // Solo si el servidor tiene Google configurado
    if (calendar?.available) {
      steps.push({
        id: 'calendar',
        label: 'tutorial.gettingStarted.calendar',
        done: calendar.connected,
        link: '/perfil',
        fragment: 'calendario',
      });
    }
    return steps;
  });
  protected readonly doneCount = computed(() => this.steps().filter((s) => s.done).length);
  protected readonly visible = computed(
    () =>
      !!this.families.active() &&
      this.hasList() !== null &&
      this.auth.user()?.tutorials?.['getting-started']?.state !== 'done' &&
      this.doneCount() < this.steps().length,
  );

  constructor() {
    void this.calendar.load();
    effect(() => {
      const family = this.families.active();
      const me = this.auth.user()?.id;
      if (!family || !me) return;
      untracked(() =>
        this.lists
          .familyLists(family.id)
          .then((data) => this.hasList.set(data.lists.some((l) => l.createdBy?.id === me)))
          .catch(() => this.hasList.set(null)),
      );
    });
  }

  protected hide(): void {
    void this.tutorial.save('getting-started', { state: 'done' });
  }
}
