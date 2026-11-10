import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, model, output, signal, untracked } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { CodePromptComponent } from '../../shared/code-prompt.component';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { ListDetail, SecretField, SecretFieldKind, SecretSummary } from './lists.models';
import { SecretsService } from './secrets.service';

const KINDS: { id: SecretFieldKind; label: TranslationKey }[] = [
  { id: 'username', label: 'secrets.kinds.username' },
  { id: 'password', label: 'secrets.kinds.password' },
  { id: 'pin', label: 'secrets.kinds.pin' },
  { id: 'url', label: 'secrets.kinds.url' },
  { id: 'text', label: 'secrets.kinds.text' },
  { id: 'note', label: 'secrets.kinds.note' },
];

/** Cuánto se ve un valor después de tocar "Mostrar", y cuánto queda en el portapapeles */
const REVEAL_MS = 30_000;
const CLIPBOARD_MS = 30_000;

interface Draft {
  title: string;
  fields: SecretField[];
}

/**
 * Elementos de una lista secreta. Sin código se ven solo los títulos. Con el código del correo
 * la lista queda desbloqueada mientras la pantalla esté abierta: al salir, se olvida todo.
 */
@Component({
  selector: 'oh-secret-list',
  imports: [NgTemplateOutlet, TPipe, CodePromptComponent],
  templateUrl: './secret-list.component.html',
  styleUrl: './secret-list.component.scss',
})
export class SecretListComponent {
  readonly list = model.required<ListDetail>();
  /** La lista se borró: la pantalla vuelve a las listas */
  readonly deleted = output<void>();

  private readonly api = inject(SecretsService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly kinds = KINDS;
  /** Permiso de desbloqueo: solo en memoria de esta pantalla */
  private readonly token = signal<string | null>(null);
  protected readonly unlocked = computed(() => this.token() !== null);
  /** Valores descifrados por elemento (se borran al salir) */
  private readonly values = signal<ReadonlyMap<string, SecretField[]>>(new Map());
  /** Valores a la vista ("itemId:índice"), cada uno por 30 segundos */
  protected readonly shown = signal<ReadonlySet<string>>(new Set());
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  protected readonly query = signal('');
  protected readonly unlocking = signal(false);
  protected readonly codeError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly adding = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());

  protected readonly supervision = computed(() => this.list().permissions.supervision);
  protected readonly items = computed(() => this.list().secretItems ?? []);
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    return q ? this.items().filter((i) => i.title.toLocaleLowerCase().includes(q)) : this.items();
  });
  /** Dueño de la lista (solo él puede cambiar su privacidad): puede borrarla entera */
  protected readonly isOwner = computed(() => !this.supervision() && this.list().permissions.canChangePrivacy);
  /** La lista completa solo se puede borrar si todos sus elementos son de su dueño */
  protected readonly othersItems = computed(() => this.items().filter((i) => !i.mine).length);

  constructor() {
    // Al salir de la lista se bloquea: se olvidan el permiso, los valores y el portapapeles programado
    inject(DestroyRef).onDestroy(() => {
      this.token.set(null);
      this.values.set(new Map());
      for (const t of this.timers) clearTimeout(t);
    });
    // Si aparecen elementos nuevos (de otras personas) estando desbloqueada, trae sus valores
    effect(() => {
      const missing = this.items().some((i) => !this.values().has(i.id));
      if (missing && this.unlocked()) untracked(() => void this.reveal());
    });
  }

  private emptyDraft(): Draft {
    return {
      title: '',
      fields: [
        { label: this.i18n.t('secrets.kinds.username'), kind: 'username', value: '' },
        { label: this.i18n.t('secrets.kinds.password'), kind: 'password', value: '' },
      ],
    };
  }

  // ---------- Desbloqueo ----------

  async unlock(code: string): Promise<void> {
    this.unlocking.set(true);
    this.codeError.set(null);
    try {
      this.token.set(await this.api.unlock(this.list().id, code, this.supervision()));
      await this.reveal();
    } catch (err) {
      const e = toApiError(err);
      this.codeError.set(this.i18n.error(e.code, e.details));
    } finally {
      this.unlocking.set(false);
    }
  }

  private async reveal(): Promise<void> {
    const token = this.token();
    if (!token) return;
    try {
      const res = await this.api.reveal(this.list().id, token, this.supervision());
      this.token.set(res.token);
      this.values.set(new Map(res.items.map((i) => [i.id, i.fields])));
    } catch (err) {
      this.handle(err);
    }
  }

  lock(): void {
    this.token.set(null);
    this.values.set(new Map());
    this.shown.set(new Set());
    this.editingId.set(null);
  }

  /** El permiso venció (30 minutos sin actividad) o no es válido: vuelve a pedir el código */
  private handle(err: unknown): void {
    const e = toApiError(err);
    if (e.code === 'SECRETS_LOCKED') {
      this.lock();
      this.codeError.set(this.i18n.t('secrets.expired'));
    } else {
      this.error.set(this.i18n.error(e.code, e.details));
    }
  }

  // ---------- Ver y copiar ----------

  protected fieldsOf(item: SecretSummary): SecretField[] {
    return this.values().get(item.id) ?? [];
  }

  protected isShown(itemId: string, index: number): boolean {
    return this.shown().has(`${itemId}:${index}`);
  }

  protected toggleShow(itemId: string, index: number): void {
    const key = `${itemId}:${index}`;
    const next = new Set(this.shown());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.shown.update((s) => {
          const after = new Set(s);
          after.delete(key);
          return after;
        });
      }, REVEAL_MS);
      this.timers.add(timer);
    }
    this.shown.set(next);
  }

  protected mask(field: SecretField): string {
    return field.value ? '•'.repeat(Math.min(Math.max(field.value.length, 6), 14)) : '—';
  }

  protected kindLabel(kind: SecretFieldKind): TranslationKey {
    return KINDS.find((k) => k.id === kind)?.label ?? 'secrets.kinds.text';
  }

  async copy(field: SecretField): Promise<void> {
    try {
      await navigator.clipboard.writeText(field.value);
      this.toast.show(this.i18n.t('secrets.copied'));
      // Borra el portapapeles a los 30 segundos (si sigue teniendo este valor y la app está al frente)
      const timer = setTimeout(async () => {
        this.timers.delete(timer);
        try {
          if ((await navigator.clipboard.readText()) === field.value) await navigator.clipboard.writeText('');
        } catch {
          await navigator.clipboard.writeText('').catch(() => undefined);
        }
      }, CLIPBOARD_MS);
      this.timers.add(timer);
    } catch {
      this.error.set(this.i18n.t('secrets.copyFailed'));
    }
  }

  // ---------- Agregar y editar ----------

  /** Campos ocultos (contraseña, PIN) que se están viendo mientras se escribe */
  protected readonly shownInputs = signal<ReadonlySet<number>>(new Set());

  protected toggleInput(index: number): void {
    this.shownInputs.update((s) => {
      const next = new Set(s);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  startAdd(): void {
    this.shownInputs.set(new Set());
    this.editingId.set(null);
    this.draft.set(this.emptyDraft());
    this.adding.set(true);
  }

  startEdit(item: SecretSummary): void {
    this.shownInputs.set(new Set());
    this.adding.set(false);
    this.draft.set({ title: item.title, fields: this.fieldsOf(item).map((f) => ({ ...f })) });
    this.editingId.set(item.id);
  }

  cancelEdit(): void {
    this.shownInputs.set(new Set());
    this.adding.set(false);
    this.editingId.set(null);
  }

  protected setTitle(value: string): void {
    this.draft.update((d) => ({ ...d, title: value }));
  }

  protected setField(index: number, change: Partial<SecretField>): void {
    this.draft.update((d) => ({ ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...change } : f)) }));
  }

  /** Al elegir el tipo, propone su nombre si el campo todavía tiene el nombre de otro tipo */
  protected setKind(index: number, kind: SecretFieldKind): void {
    const field = this.draft().fields[index]!;
    const defaultLabels = KINDS.map((k) => this.i18n.t(k.label));
    this.setField(index, { kind, label: !field.label || defaultLabels.includes(field.label) ? this.i18n.t(this.kindLabel(kind)) : field.label });
  }

  protected addField(): void {
    this.draft.update((d) => ({ ...d, fields: [...d.fields, { label: this.i18n.t('secrets.kinds.text'), kind: 'text', value: '' }] }));
  }

  protected removeField(index: number): void {
    // Los campos se corren de lugar: todos vuelven a quedar ocultos
    this.shownInputs.set(new Set());
    this.draft.update((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== index) }));
  }

  protected readonly draftValid = computed(() => {
    const d = this.draft();
    return d.title.trim().length > 0 && d.fields.length <= 20 && d.fields.every((f) => f.label.trim().length > 0);
  });

  private cleanDraft(): Draft {
    const d = this.draft();
    return { title: d.title.trim(), fields: d.fields.map((f) => ({ ...f, label: f.label.trim() })) };
  }

  async saveNew(): Promise<void> {
    if (!this.draftValid()) return;
    const { title, fields } = this.cleanDraft();
    await this.run(async () => {
      const item = await this.api.create(this.list().id, title, fields);
      this.list.update((l) => ({ ...l, secretItems: [...(l.secretItems ?? []), item], counts: { ...l.counts, total: l.counts.total + 1 } }));
      this.values.update((m) => new Map(m).set(item.id, fields));
      this.adding.set(false);
    });
  }

  async saveEdit(item: SecretSummary): Promise<void> {
    const token = this.token();
    if (!this.draftValid() || !token) return;
    const { title, fields } = this.cleanDraft();
    await this.run(async () => {
      const saved = await this.api.update(this.list().id, item.id, token, { title, fields });
      this.list.update((l) => ({ ...l, secretItems: (l.secretItems ?? []).map((i) => (i.id === item.id ? saved : i)) }));
      this.values.update((m) => new Map(m).set(item.id, fields));
      this.editingId.set(null);
    });
  }

  // ---------- Borrar ----------

  async remove(item: SecretSummary): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('secrets.deleteTitle', { title: item.title }),
      message: this.i18n.t('secrets.deleteBody'),
      confirmLabel: this.i18n.t('secrets.delete'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.api.remove(this.list().id, item.id);
      this.list.update((l) => ({
        ...l,
        secretItems: (l.secretItems ?? []).filter((i) => i.id !== item.id),
        counts: { ...l.counts, total: Math.max(0, l.counts.total - 1) },
      }));
      this.values.update((m) => {
        const next = new Map(m);
        next.delete(item.id);
        return next;
      });
    });
  }

  async removeList(): Promise<void> {
    const token = this.token();
    if (!token && this.items().length) return;
    const ok = await this.confirm.ask({
      title: this.i18n.t('secrets.deleteListTitle', { name: this.list().name }),
      message: this.i18n.t('secrets.deleteListBody', { n: this.items().length }),
      confirmLabel: this.i18n.t('secrets.deleteList'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.api.removeList(this.list().id, token);
      this.lock();
      this.deleted.emit();
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
    } catch (err) {
      this.handle(err);
    } finally {
      this.busy.set(false);
    }
  }
}
