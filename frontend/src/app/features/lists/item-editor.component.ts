import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { GoogleCalendarService } from '../calendar/google-calendar.service';
import { FamilyMember } from '../families/families.service';
import { ProfileService } from '../profile/profile.service';
import { unitsFor } from './item-logic';
import { DEFAULT_FEATURES, ListFeature } from './list-presets';
import { ListDetail, ListItem } from './lists.models';
import { ItemChanges } from './lists.store';

/** default = lo que diga el perfil de quien recibe la tarea */
type ReminderMode = 'default' | 'custom' | 'off';

export interface ItemEditorResult {
  changes: ItemChanges & { text: string };
  /** Solo al crear: subtareas para agregar debajo */
  subtasks: string[];
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

/**
 * Ventana con todos los datos de un elemento, para crearlo o editarlo de una vez.
 * Muestra solo los campos de las opciones activas de la lista.
 */
@Component({
  selector: 'oh-item-editor',
  imports: [ReactiveFormsModule, RouterLink, TPipe],
  templateUrl: './item-editor.component.html',
  styleUrl: './item-editor.component.scss',
})
export class ItemEditorComponent {
  readonly list = input.required<ListDetail>();
  readonly members = input<FamilyMember[]>([]);
  /** null = elemento nuevo */
  readonly item = input<ListItem | null>(null);
  /** Para un elemento nuevo: el título ya escrito en el campo rápido, o la tarea de la que será subtarea */
  readonly initialText = input('');
  readonly parentId = input<string | null>(null);
  readonly saved = output<ItemEditorResult>();
  readonly deleted = output<void>();
  /** Editando una tarea: agregar una subtarea debajo (cierra la ventana) */
  readonly addSubtask = output<void>();
  readonly closed = output<void>();

  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  private readonly calendar = inject(GoogleCalendarService);
  private readonly profile = inject(ProfileService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  private readonly features = computed<ReadonlySet<ListFeature>>(
    () => new Set(this.list().features ?? DEFAULT_FEATURES[this.list().type]),
  );
  protected readonly has = (feature: ListFeature) => this.features().has(feature);
  protected readonly isNew = computed(() => this.item() === null);
  /** Las subtareas solo existen un nivel: no en una subtarea */
  protected readonly canHaveSubtasks = computed(
    () => this.has('subtasks') && !this.parentId() && !this.item()?.parentId,
  );
  protected readonly units = computed(() => unitsFor(this.i18n.locale()));
  protected readonly categories = computed(() => [
    ...new Set(
      this.list()
        .items.map((i) => i.category?.trim())
        .filter((c): c is string => !!c),
    ),
  ]);
  protected readonly defaults = computed(() => ({
    startDays: 3,
    everyDays: 1,
    ...this.auth.user()?.reminders,
  }));

  protected readonly form = inject(FormBuilder).nonNullable.group({
    text: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', Validators.maxLength(2000)],
    amount: ['' as string | number | null],
    unit: ['', Validators.maxLength(20)],
    category: ['', Validators.maxLength(40)],
    assigneeId: [''],
    dueDate: [''],
    dueTime: [''],
    reminderMode: ['default' as ReminderMode],
    reminderStart: [3],
    reminderEvery: [1],
  });
  /** Subtareas que se crean junto con el elemento nuevo */
  protected readonly newSubtasks = signal<string[]>([]);

  /** Aviso al poner una fecha: "puedes llevar tus tareas a Google Calendar" */
  private readonly promptClosed = signal(false);
  protected readonly calendarPrompt = computed(() => {
    const status = this.calendar.status();
    return (
      !!status?.available &&
      !status.connected &&
      !this.auth.user()?.calendarPromptDismissed &&
      !this.promptClosed()
    );
  });

  constructor() {
    effect(() => {
      const item = this.item();
      const d = this.defaults();
      this.form.reset({
        text: item?.text ?? this.initialText(),
        description: item?.description ?? '',
        amount: item?.amount === null || item?.amount === undefined ? '' : String(item.amount),
        unit: item?.unit ?? '',
        category: item?.category ?? '',
        assigneeId: item?.assigneeId ?? '',
        dueDate: item?.dueDate ?? '',
        dueTime: item?.dueTime ?? '',
        reminderMode: item?.reminders?.off
          ? 'off'
          : item?.reminders?.startDays != null
            ? 'custom'
            : 'default',
        reminderStart: item?.reminders?.startDays ?? d.startDays,
        reminderEvery: item?.reminders?.everyDays ?? d.everyDays,
      });
      if (this.has('due')) void this.calendar.load();
      const el = this.dialog().nativeElement;
      if (!el.open) el.showModal();
      setTimeout(() => (el.querySelector('#item-text') as HTMLInputElement | null)?.focus());
    });
  }

  dismissCalendarPrompt(forever: boolean): void {
    this.promptClosed.set(true);
    if (forever)
      void this.profile.setSettings({ calendarPromptDismissed: true }).catch(() => undefined);
  }

  protected addSubtaskRow(): void {
    this.newSubtasks.update((s) => [...s, '']);
    setTimeout(() =>
      (
        this.dialog().nativeElement.querySelector(
          '.new-subtasks li:last-child input',
        ) as HTMLInputElement | null
      )?.focus(),
    );
  }

  protected setSubtask(index: number, value: string): void {
    this.newSubtasks.update((s) => s.map((v, i) => (i === index ? value : v)));
  }

  protected removeSubtask(index: number): void {
    this.newSubtasks.update((s) => s.filter((_, i) => i !== index));
  }

  /** Cantidad escrita: número positivo o vacío (acepta coma decimal; input number entrega número o null) */
  private amountOf(raw: string | number | null): number | null {
    const text = String(raw ?? '').trim();
    const value = Number(text.replace(',', '.'));
    return text && value > 0 ? value : null;
  }

  /** Solo los campos de las opciones activas: lo de una opción apagada no se toca */
  private changes(): ItemChanges & { text: string } {
    const v = this.form.getRawValue();
    const changes: ItemChanges & { text: string } = {
      text: v.text.trim(),
      description: v.description.trim() || null,
    };
    if (this.has('quantity')) {
      const amount = this.amountOf(v.amount);
      Object.assign(changes, { amount, unit: amount !== null ? v.unit.trim() || null : null });
    }
    if (this.has('category')) changes.category = v.category.trim() || null;
    if (this.has('assignee')) changes.assigneeId = v.assigneeId || null;
    if (this.has('due')) {
      const dueDate = v.dueDate || null;
      const custom = v.reminderMode === 'custom';
      Object.assign(changes, {
        dueDate,
        dueTime: dueDate ? v.dueTime || null : null,
        remindersOff: v.reminderMode === 'off',
        reminderStartDays: custom ? clamp(v.reminderStart, 0, 60) : null,
        reminderEveryDays: custom ? clamp(v.reminderEvery, 1, 30) : null,
      });
    }
    return changes;
  }

  save(): void {
    if (this.form.invalid) return;
    this.saved.emit({
      changes: this.changes(),
      subtasks: this.newSubtasks()
        .map((s) => s.trim())
        .filter(Boolean),
    });
    this.dialog().nativeElement.close();
  }

  newSubtaskBelow(): void {
    this.addSubtask.emit();
    this.dialog().nativeElement.close();
  }

  remove(): void {
    this.deleted.emit();
    this.dialog().nativeElement.close();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }
}
