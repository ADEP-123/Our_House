import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ToastService } from '../../shared/toast.service';
import { dueLabel } from '../lists/due-label';
import { dueInfo } from '../lists/item-logic';
import { colorOf, iconOf } from '../lists/list-presets';
import { MyTask } from '../lists/lists.models';
import { ListsStore } from '../lists/lists.store';

interface Section {
  key: 'overdue' | 'today' | 'upcoming' | 'noDate';
  title: TranslationKey;
  tasks: MyTask[];
}

/** Todo lo asignado a mí en todos mis grupos: vencidas, hoy, próximas y sin fecha. */
@Component({
  selector: 'oh-my-tasks-page',
  imports: [RouterLink, TPipe],
  template: `
    <header class="head">
      <h1>{{ 'myTasks.title' | t }}</h1>
      <p class="oh-muted">{{ 'myTasks.intro' | t }}</p>
    </header>

    @if (error(); as err) {
      <p class="oh-alert is-error" role="alert">{{ err }}</p>
    }

    @if (tasks() === null) {
      <p class="oh-muted" role="status">{{ 'common.loading' | t }}</p>
    } @else if (!pendingCount()) {
      <section class="empty">
        <p class="big" aria-hidden="true">🎉</p>
        <p>{{ 'myTasks.empty' | t }}</p>
        <a class="oh-btn oh-btn--outline" routerLink="/listas">{{ 'myTasks.goLists' | t }}</a>
      </section>
    } @else {
      @for (section of sections(); track section.key) {
        @if (section.tasks.length) {
          <section class="section" [attr.data-kind]="section.key">
            <h2>{{ section.title | t }} <span class="count">{{ section.tasks.length }}</span></h2>
            <ul class="tasks">
              @for (task of section.tasks; track task.id) {
                <li class="task" [style.--list-color]="color(task)">
                  <button
                    type="button"
                    class="check"
                    role="checkbox"
                    aria-checked="false"
                    [attr.aria-label]="'lists.items.markDone' | t: { text: task.text }"
                    (click)="complete(task)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </button>
                  <div class="body">
                    <span class="text">{{ task.text }}</span>
                    @if (task.parentText) {
                      <span class="parent">{{ 'myTasks.subtaskOf' | t: { task: task.parentText } }}</span>
                    }
                    <span class="meta">
                      <a class="tag list" [routerLink]="['/listas', task.list.id]">{{ icon(task) }} {{ task.list.name }}</a>
                      @if (multipleFamilies()) {
                        <span class="tag">{{ task.family.name }}</span>
                      }
                      @if (due(task); as d) {
                        <span class="tag" [class.overdue]="d.kind === 'overdue'" [class.today]="d.kind === 'today'">📅 {{ d.text }}</span>
                      }
                    </span>
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      }
    }
  `,
  styles: `
    .head {
      margin-bottom: 24px;
    }
    h1 {
      font-size: 1.75rem;
      margin-bottom: 4px;
    }
    .section + .section {
      margin-top: 24px;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9375rem;
      margin-bottom: 10px;
    }
    .section[data-kind='overdue'] h2 {
      color: var(--oh-error);
    }
    .count {
      font-size: 0.75rem;
      padding: 1px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, currentColor 12%, transparent);
    }
    .tasks {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--oh-border);
      border-radius: var(--oh-radius-lg);
      background: var(--oh-surface);
      overflow: hidden;
    }
    .task {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
      padding: 12px;
    }
    .task + .task {
      border-top: 1px solid var(--oh-border);
    }
    .check {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      margin-top: 1px;
      border: 2px solid var(--oh-border-strong);
      border-radius: 9px;
      background: var(--oh-surface);
      color: transparent;
      cursor: pointer;
    }
    .check:hover {
      border-color: var(--list-color, var(--oh-primary));
      color: color-mix(in srgb, var(--list-color, var(--oh-primary)) 50%, transparent);
    }
    .check svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .body {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .text {
      overflow-wrap: anywhere;
    }
    .parent {
      font-size: 0.8125rem;
      color: var(--oh-text-muted);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tag {
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 0.8125rem;
      color: var(--oh-text);
      text-decoration: none;
      background: color-mix(in srgb, var(--list-color, var(--oh-primary)) 12%, var(--oh-surface));
    }
    .tag.list:hover {
      text-decoration: underline;
    }
    .tag.today {
      background: color-mix(in srgb, #e8a33d 22%, var(--oh-surface));
      font-weight: 600;
    }
    .tag.overdue {
      background: var(--oh-error-soft);
      color: var(--oh-error);
      font-weight: 600;
    }
    .empty {
      display: grid;
      justify-items: center;
      gap: 12px;
      padding: 48px 16px;
      text-align: center;
    }
    .big {
      font-size: 2.5rem;
    }
  `,
})
export class MyTasksPage implements OnInit {
  private readonly store = inject(ListsStore);
  private readonly toast = inject(ToastService);
  private readonly sync = inject(SyncStatus);
  private readonly i18n = inject(I18n);

  protected readonly tasks = signal<MyTask[] | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Marcadas en esta pantalla: se ocultan (con opción de deshacer) */
  private readonly done = signal<ReadonlySet<string>>(new Set());

  private readonly pending = computed(() => (this.tasks() ?? []).filter((t) => !t.completedAt && !this.done().has(t.id)));
  protected readonly pendingCount = computed(() => this.pending().length);
  protected readonly multipleFamilies = computed(() => new Set((this.tasks() ?? []).map((t) => t.family.id)).size > 1);

  protected readonly sections = computed<Section[]>(() => {
    const now = new Date();
    const sections: Section[] = [
      { key: 'overdue', title: 'myTasks.overdue', tasks: [] },
      { key: 'today', title: 'myTasks.today', tasks: [] },
      { key: 'upcoming', title: 'myTasks.upcoming', tasks: [] },
      { key: 'noDate', title: 'myTasks.noDate', tasks: [] },
    ];
    for (const task of this.pending()) {
      const info = dueInfo(task, now);
      const index = !info ? 3 : info.kind === 'overdue' ? 0 : info.kind === 'today' ? 1 : 2;
      sections[index]!.tasks.push(task);
    }
    return sections;
  });

  constructor() {
    // Al día con lo que asignan los demás: cada 15 segundos, al volver a la app y al sincronizar
    const refresh = () => {
      if (document.visibilityState === 'visible' && this.store.pending() === 0 && this.sync.queued() === 0) void this.load();
    };
    const timer = setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
    effect(() => {
      if (this.store.synced() > 0) untracked(() => refresh());
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.tasks.set(await this.store.myTasks());
      this.error.set(null);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected color(task: MyTask): string {
    return colorOf(task.list.color);
  }

  protected icon(task: MyTask): string {
    return iconOf(task.list.icon);
  }

  protected due(task: MyTask) {
    return dueLabel(task, this.i18n);
  }

  /** Marca como hecha y la quita de la vista, con "Deshacer" */
  async complete(task: MyTask): Promise<void> {
    this.done.update((s) => new Set(s).add(task.id));
    try {
      await this.store.setCompleted(task.list.id, task.id, true);
      this.toast.show(this.i18n.t('myTasks.completed', { task: task.text }), {
        actionLabel: this.i18n.t('lists.detail.undo'),
        action: () => void this.undo(task),
      });
    } catch (err) {
      this.restore(task.id);
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  private async undo(task: MyTask): Promise<void> {
    this.restore(task.id);
    try {
      await this.store.setCompleted(task.list.id, task.id, false);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  private restore(id: string): void {
    this.done.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }
}
