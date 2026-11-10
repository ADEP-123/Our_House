import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FamiliesService, FamilyMember } from '../families/families.service';
import { ListFormComponent } from './list-form.component';
import { ListType, iconOf } from './list-presets';
import { LIST_TEMPLATES, ListTemplate } from './list-templates';
import { ListDetail, ListInput } from './lists.models';
import { ListsStore } from './lists.store';

interface StarterItem {
  text: string;
  on: boolean;
}

/**
 * Pantalla propia para crear una lista (con plantillas y sugerencias del grupo) o editarla.
 * /listas/nueva?familia=… y /listas/:id/editar
 */
@Component({
  selector: 'oh-list-edit-page',
  imports: [RouterLink, TPipe, ListFormComponent],
  templateUrl: './list-edit.page.html',
  styleUrl: './list-edit.page.scss',
})
export class ListEditPage implements OnInit {
  /** :id de la ruta (editar) */
  readonly id = input<string>();
  /** ?familia= (crear): grupo donde se crea; si no, el activo */
  readonly familia = input<string>();

  protected readonly families = inject(FamiliesService);
  private readonly store = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  protected readonly templates = LIST_TEMPLATES;
  protected readonly iconOf = iconOf;
  protected readonly list = signal<ListDetail | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // ---------- Crear ----------
  protected readonly familyId = signal<string | null>(null);
  protected readonly family = computed(
    () => this.families.families()?.find((f) => f.id === this.familyId()) ?? null,
  );
  protected readonly template = signal<ListTemplate>(LIST_TEMPLATES[0]!);
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
  protected readonly type = signal<ListType>('todo');
  protected readonly starter = signal<StarterItem[]>([]);
  protected readonly ownText = signal('');
  private readonly allSuggestions = signal<string[]>([]);
  /** Sugerencias que todavía no están en la lista */
  protected readonly suggestions = computed(() => {
    const taken = new Set(this.starter().map((s) => s.text.toLowerCase()));
    return this.allSuggestions().filter((s) => !taken.has(s.toLowerCase()));
  });
  private readonly members = signal<FamilyMember[]>([]);
  protected readonly rotate = signal(true);
  protected readonly rotationNames = computed(() =>
    this.members()
      .map((m) => m.nickname)
      .join(', '),
  );
  protected readonly canRotate = computed(
    () => !!this.template().rotation && this.members().length > 1,
  );

  constructor() {
    // Al cambiar de grupo o de tipo: sugerencias de ese grupo y tipo, y sus miembros para los turnos
    effect(() => {
      const familyId = this.familyId();
      const type = this.type();
      if (!familyId || this.id()) return;
      untracked(() => {
        this.allSuggestions.set([]);
        if (type !== 'secret')
          void this.store.suggestions(familyId, type).then((s) => this.allSuggestions.set(s));
      });
    });
    effect(() => {
      const familyId = this.familyId();
      if (!familyId || this.id()) return;
      untracked(() =>
        this.families
          .detail(familyId)
          .then((f) => this.members.set(f.members))
          .catch(() => this.members.set([])),
      );
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
    const id = this.id();
    if (id) {
      try {
        this.list.set(await this.store.detail(id));
      } catch (err) {
        this.error.set(this.i18n.error(toApiError(err).code));
      }
      return;
    }
    this.familyId.set(this.familia() ?? this.families.active()?.id ?? null);
    this.choose(LIST_TEMPLATES[0]!);
  }

  protected templateName(t: ListTemplate): string {
    return this.i18n.t(`lists.screen.templateNames.${t.id}`);
  }

  choose(template: ListTemplate): void {
    this.template.set(template);
    this.starter.set(template.items[this.i18n.locale()].map((text) => ({ text, on: true })));
    this.rotate.set(true);
  }

  protected toggleStarter(index: number): void {
    this.starter.update((items) => items.map((s, i) => (i === index ? { ...s, on: !s.on } : s)));
  }

  protected addStarter(text: string): void {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    const existing = this.starter().findIndex((s) => s.text.toLowerCase() === clean.toLowerCase());
    if (existing >= 0)
      this.starter.update((items) =>
        items.map((s, i) => (i === existing ? { ...s, on: true } : s)),
      );
    else this.starter.update((items) => [...items, { text: clean, on: true }]);
  }

  protected addOwn(): void {
    this.addStarter(this.ownText());
    this.ownText.set('');
  }

  async create(input: ListInput): Promise<void> {
    const familyId = this.familyId();
    if (!familyId) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const list = await this.store.create(familyId, input);
      if (input.type !== 'secret') await this.addStarterItems(list.id, input);
      await this.router.navigate(['/listas', list.id], { replaceUrl: true });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }

  /** Los elementos marcados; en plantillas con repetición, repitiéndose y (si se quiere) por turnos */
  private async addStarterItems(listId: string, input: ListInput): Promise<void> {
    const t = this.template();
    const repeat = t.repeat && input.features.includes('repeat') ? t.repeat : null;
    const people =
      repeat && this.canRotate() && this.rotate() && input.features.includes('assignee')
        ? this.members().map((m) => m.userId)
        : null;
    const texts = this.starter()
      .filter((s) => s.on)
      .map((s) => s.text);
    for (const [i, text] of texts.entries()) {
      // Cada tarea empieza con una persona distinta, para repartir desde el primer día
      const rotation = people
        ? [...people.slice(i % people.length), ...people.slice(0, i % people.length)]
        : null;
      await this.store.addItem(listId, {
        text,
        ...(repeat ? { repeat } : {}),
        ...(rotation ? { rotation } : {}),
      });
    }
  }

  // ---------- Editar ----------

  protected supervisedIn(familyId: string): boolean {
    return this.families.families()?.find((f) => f.id === familyId)?.role === 'supervised';
  }

  async save(changes: ListInput): Promise<void> {
    const id = this.id()!;
    const { type: _type, ...editable } = changes;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.update(id, editable);
      await this.router.navigate(['/listas', id], { replaceUrl: true });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }

  cancel(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/listas', id] : ['/listas']);
  }
}
