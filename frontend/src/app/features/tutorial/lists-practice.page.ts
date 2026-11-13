import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FamilyMember } from '../families/families.service';
import { ListFormComponent } from '../lists/list-form.component';
import { ListItemsComponent } from '../lists/list-items.component';
import { ListPaymentsService } from '../lists/list-payments.service';
import { colorOf, DEFAULT_FEATURES, iconOf } from '../lists/list-presets';
import { LIST_TEMPLATES, ListTemplate } from '../lists/list-templates';
import { ListDetail, ListInput } from '../lists/lists.models';
import { ListsStore } from '../lists/lists.store';
import { PracticeBannerComponent } from './practice-banner.component';
import { PracticeListsStore } from './practice-lists.store';
import { TourDefinition, TutorialService } from './tutorial.service';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const editorOpen = () => !!document.querySelector('oh-item-editor dialog[open]');

/**
 * Práctica del tutorial de listas: la pantalla de crear lista y la de una lista, con los mismos
 * componentes de siempre pero sobre una lista en memoria. Nada llega al servidor.
 */
@Component({
  selector: 'oh-lists-practice-page',
  imports: [TPipe, PracticeBannerComponent, ListFormComponent, ListItemsComponent],
  providers: [
    PracticeListsStore,
    { provide: ListsStore, useExisting: PracticeListsStore },
    ListPaymentsService,
  ],
  template: `
    <oh-practice-banner />
    @if (store.list(); as l) {
      <div class="page" [style.--list-color]="color(l)">
        <header class="head">
          <span class="icon" aria-hidden="true">{{ icon(l) }}</span>
          <div>
            <h1>{{ l.name }}</h1>
            <p class="oh-muted">{{ 'tutorial.lists.practiceList' | t }}</p>
          </div>
        </header>
        <oh-list-items [list]="l" (listChange)="store.list.set($event)" [members]="members()">
          <p class="summary">
            {{ 'lists.summary' | t: { done: l.counts.completed, total: l.counts.total } }}
          </p>
        </oh-list-items>
      </div>
    } @else {
      <div class="page">
        <h1>{{ 'lists.form.createTitle' | t }}</h1>
        <section>
          <h2 class="section-title">{{ 'lists.screen.templates' | t }}</h2>
          <div class="template-row" role="group" data-tour="templates">
            @for (t of templates; track t.id) {
              <button
                type="button"
                class="template"
                [attr.aria-pressed]="template().id === t.id"
                (click)="template.set(t)"
              >
                <span class="template-icon" aria-hidden="true">{{
                  t.id === 'blank' ? '📝' : iconOf(t.icon)
                }}</span>
                <span>{{ templateName(t) }}</span>
              </button>
            }
          </div>
        </section>
        <div class="oh-panel">
          <oh-list-form
            [showTitle]="false"
            [preset]="preset()"
            (saved)="create($event)"
            (cancelled)="tutorial.pause()"
          />
        </div>
      </div>
    }
  `,
  styles: `
    .page {
      display: grid;
      gap: 18px;
      max-width: 820px;
    }
    h1 {
      margin: 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .head p {
      margin: 0;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      border-radius: 18px;
      font-size: 1.75rem;
      background: color-mix(in srgb, var(--list-color) 18%, var(--oh-surface));
    }
    .summary {
      margin: 0 0 10px;
      color: var(--oh-text-muted);
    }
    .section-title {
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0 0 10px;
    }
    .template-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .template {
      display: grid;
      justify-items: center;
      gap: 6px;
      width: 100px;
      padding: 12px 6px 10px;
      border-radius: 16px;
      border: 1px solid var(--oh-border);
      background: var(--oh-surface);
      color: var(--oh-text);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
    }
    .template[aria-pressed='true'] {
      border-color: var(--oh-primary);
      background: color-mix(in srgb, var(--oh-primary) 10%, var(--oh-surface));
    }
    .template-icon {
      font-size: 1.4rem;
    }
  `,
})
export class ListsPracticePage implements OnInit {
  protected readonly store = inject(PracticeListsStore);
  protected readonly tutorial = inject(TutorialService);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);

  /** Sin secretas: la práctica es de listas de elementos */
  protected readonly templates = LIST_TEMPLATES.filter((t) => t.type !== 'secret');
  protected readonly template = signal<ListTemplate>(LIST_TEMPLATES[0]!);
  protected readonly iconOf = iconOf;
  protected readonly preset = computed(() => {
    const t = this.template();
    return {
      name: t.name[this.i18n.locale()],
      type: t.type,
      icon: t.icon,
      color: t.color,
      features: t.features,
    };
  });

  /** Tú y dos personas de ejemplo, para responsables y turnos */
  protected readonly members = computed<FamilyMember[]>(() => {
    const me = this.auth.user();
    const person = (userId: string, nickname: string): FamilyMember => ({
      userId,
      nickname,
      firstName: null,
      lastName: null,
      avatarUrl: null,
      avatarPreset: null,
      role: 'member',
      joinedAt: '',
    });
    return [
      ...(me ? [{ ...person(me.id, me.nickname), role: 'leader' as const }] : []),
      person('practice-ana', this.i18n.t('tutorial.lists.personA')),
      person('practice-beto', this.i18n.t('tutorial.lists.personB')),
    ];
  });

  /** Para saber si se agregó algo en este paso */
  private baseline = 0;

  private readonly definition: TourDefinition = {
    id: 'lists',
    steps: [
      {
        id: 'template',
        target: '[data-tour="templates"]',
        title: 'tutorial.lists.template.title',
        body: 'tutorial.lists.template.body',
        until: () => this.template().id !== 'blank',
        ensure: () => this.store.list.set(null),
      },
      {
        id: 'create',
        target: 'oh-list-form button[type=submit]',
        title: 'tutorial.lists.create.title',
        body: 'tutorial.lists.create.body',
        until: () => !!this.store.list(),
        ensure: () => this.store.list.set(null),
      },
      {
        id: 'quick',
        target: '#new-item',
        title: 'tutorial.lists.quick.title',
        body: 'tutorial.lists.quick.body',
        until: () => this.count() > this.baseline,
        ensure: () => this.ensureList(),
      },
      {
        id: 'details',
        target: 'oh-list-items .more',
        title: 'tutorial.lists.details.title',
        body: 'tutorial.lists.details.body',
        until: () => !editorOpen() && this.count() > this.baseline,
        ensure: () => this.ensureList(),
      },
      {
        id: 'check',
        target: 'oh-list-items .item .check',
        title: 'tutorial.lists.check.title',
        body: 'tutorial.lists.check.body',
        until: () => !!this.store.list()?.items.some((i) => i.completedAt || i.purchased !== null),
        ensure: () => this.ensureList(),
      },
    ],
    extras: [
      {
        id: 'subtasks',
        title: 'tutorial.lists.extras.subtasks',
        steps: [
          {
            id: 'sub-open',
            target: 'oh-list-items .add-sub-btn',
            title: 'tutorial.lists.subOpen.title',
            body: 'tutorial.lists.subOpen.body',
            until: () => !!document.querySelector('oh-list-items .add-sub input'),
            ensure: () => this.ensureDemo('subtasks'),
          },
          {
            id: 'sub-add',
            target: 'oh-list-items .add-sub input',
            title: 'tutorial.lists.subAdd.title',
            body: 'tutorial.lists.subAdd.body',
            until: () => !!this.store.list()?.items.some((i) => i.parentId),
          },
          {
            id: 'sub-done',
            target: 'oh-list-items .item',
            title: 'tutorial.lists.subDone.title',
            body: 'tutorial.lists.subDone.body',
          },
        ],
      },
      {
        id: 'repeat',
        title: 'tutorial.lists.extras.repeat',
        steps: [
          {
            id: 'repeat-open',
            target: 'oh-list-items .text.editable',
            title: 'tutorial.lists.repeatOpen.title',
            body: 'tutorial.lists.repeatOpen.body',
            until: () => editorOpen(),
            ensure: () => this.ensureDemo('repeat'),
          },
          {
            id: 'repeat-freq',
            target: '#item-repeat',
            title: 'tutorial.lists.repeatFreq.title',
            body: 'tutorial.lists.repeatFreq.body',
            until: () =>
              (document.querySelector('#item-repeat') as HTMLSelectElement | null)?.value ===
                'weekly' || !editorOpen(),
          },
          {
            id: 'repeat-turns',
            target: 'oh-item-editor .turns',
            title: 'tutorial.lists.repeatTurns.title',
            body: 'tutorial.lists.repeatTurns.body',
            until: () => !editorOpen() && !!this.store.list()?.items[0]?.repeat,
          },
          {
            id: 'repeat-check',
            target: 'oh-list-items .item .check',
            title: 'tutorial.lists.repeatCheck.title',
            body: 'tutorial.lists.repeatCheck.body',
            until: () => (this.store.list()?.items[0]?.repeatDone ?? 0) > 0,
          },
        ],
      },
      {
        id: 'shopping',
        title: 'tutorial.lists.extras.shopping',
        steps: [
          {
            id: 'buy-open',
            target: 'oh-list-items .item .check',
            title: 'tutorial.lists.buyOpen.title',
            body: 'tutorial.lists.buyOpen.body',
            until: () => !!document.querySelector('oh-purchase-dialog dialog[open]'),
            ensure: () => this.ensureDemo('shopping'),
          },
          {
            id: 'buy-amount',
            target: '#purchase-amount',
            title: 'tutorial.lists.buyAmount.title',
            body: 'tutorial.lists.buyAmount.body',
            until: () =>
              this.store.list()?.items[0]?.purchased !== null &&
              !document.querySelector('oh-purchase-dialog dialog[open]'),
          },
          {
            id: 'buy-done',
            target: 'oh-list-items .item',
            title: 'tutorial.lists.buyDone.title',
            body: 'tutorial.lists.buyDone.body',
          },
        ],
      },
    ],
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.tutorial.detach(this.definition));
  }

  ngOnInit(): void {
    this.tutorial.attach(this.definition);
  }

  protected color(l: ListDetail): string {
    return colorOf(l.color);
  }

  protected icon(l: ListDetail): string {
    return iconOf(l.icon);
  }

  protected templateName(t: ListTemplate): string {
    return this.i18n.t(`lists.screen.templateNames.${t.id}`);
  }

  private count(): number {
    return this.store.list()?.items.length ?? 0;
  }

  /** Crear lista: con los primeros elementos de la plantilla, para tener algo que marcar */
  protected create(input: ListInput): void {
    const items = this.template()
      .items[this.i18n.locale()].slice(0, 3)
      .map((text) => ({ text }));
    this.store.build(input, items);
    this.baseline = this.count();
  }

  /** Al retomar en un paso de la lista: la lista ya creada */
  private ensureList(): void {
    if (!this.store.list()) {
      const t = LIST_TEMPLATES.find((x) => x.id === 'groceries')!;
      this.template.set(t);
      const p = this.preset();
      this.create({
        name: p.name,
        type: p.type,
        icon: p.icon,
        color: p.color,
        features: p.features ?? DEFAULT_FEATURES[p.type],
        isPrivate: false,
      });
    }
    this.baseline = this.count();
  }

  /** Cada opcional arranca con su propia lista de ejemplo */
  private ensureDemo(kind: 'subtasks' | 'repeat' | 'shopping'): void {
    const t = (key: Parameters<I18n['t']>[0]) => this.i18n.t(key);
    if (kind === 'subtasks') {
      this.store.build(
        {
          name: t('tutorial.lists.demo.party'),
          type: 'todo',
          icon: 'gift',
          color: 'pink',
          isPrivate: false,
          features: ['assignee', 'due', 'subtasks', 'repeat'],
        },
        [{ text: t('tutorial.lists.demo.partyTask') }],
      );
    } else if (kind === 'repeat') {
      this.store.build(
        {
          name: t('tutorial.lists.demo.home'),
          type: 'todo',
          icon: 'broom',
          color: 'teal',
          isPrivate: false,
          features: ['assignee', 'due', 'subtasks', 'repeat'],
        },
        [{ text: t('tutorial.lists.demo.trash'), dueDate: today() }],
      );
    } else {
      this.store.build(
        {
          name: t('tutorial.lists.demo.groceries'),
          type: 'shopping',
          icon: 'cart',
          color: 'green',
          isPrivate: false,
          features: ['quantity', 'category', 'purchases', 'repeat'],
        },
        [{ text: t('tutorial.lists.demo.milk'), amount: 2, unit: 'L' }],
      );
    }
  }
}
