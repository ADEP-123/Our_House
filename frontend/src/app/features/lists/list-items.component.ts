import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { RouterLink } from '@angular/router';
import { ConfirmService } from '../../shared/confirm.service';
import { GoogleCalendarService } from '../calendar/google-calendar.service';
import { ProfileService } from '../profile/profile.service';
import { ToastService } from '../../shared/toast.service';
import { FamilyMember } from '../families/families.service';
import { applyPurchase, applyToggle, formatAmount, formatMoney, isPartial, removeItem, syncParent, unitsFor } from './item-logic';
import { dueLabel } from './due-label';
import { ListDetail, ListItem } from './lists.models';
import { PurchaseDialogComponent, PurchaseInput } from './purchase-dialog.component';
import { ItemChanges, ListsStore, NewItem } from './lists.store';

/** default = lo que diga el perfil de quien recibe la tarea */
type ReminderMode = 'default' | 'custom' | 'off';

interface Group {
  key: string;
  label: string | null;
  items: ListItem[];
}

const UNDO_MS = 5000;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

/** Checklist de una lista: agregar, marcar, editar, reordenar, borrar con deshacer, reiniciar y limpiar. */
@Component({
  selector: 'oh-list-items',
  imports: [ReactiveFormsModule, NgTemplateOutlet, RouterLink, TPipe, CdkDropList, CdkDrag, CdkDragHandle, PurchaseDialogComponent],
  templateUrl: './list-items.component.html',
  styleUrl: './list-items.component.scss',
})
export class ListItemsComponent implements OnDestroy {
  /** La lista se comparte con la pantalla: cada cambio local se refleja en el resumen */
  readonly list = model.required<ListDetail>();
  readonly members = input<FamilyMember[]>([]);

  private readonly store = inject(ListsStore);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly calendar = inject(GoogleCalendarService);
  private readonly profile = inject(ProfileService);

  protected readonly canEdit = computed(() => this.list().permissions.canEdit);
  protected readonly canCheck = computed(() => this.list().permissions.canCheck);
  protected readonly isShopping = computed(() => this.list().type === 'shopping');
  protected readonly isTodo = computed(() => this.list().type === 'todo');
  protected readonly error = signal<string | null>(null);
  protected readonly showMore = signal(false);
  protected readonly editingId = signal<string | null>(null);
  /** Ítem de compras cuyo diálogo "¿Cuánto compraste?" está abierto */
  protected readonly buying = signal<ListItem | null>(null);
  protected readonly units = computed(() => unitsFor(this.i18n.locale()));
  /** Recordatorios por defecto (perfil) para proponer al personalizar */
  protected readonly defaults = computed(() => ({ startDays: 3, everyDays: 1, ...this.auth.user()?.reminders }));
  protected readonly isPartial = isPartial;
  /** Tarea en la que se está escribiendo una subtarea */
  protected readonly addingSubtaskTo = signal<string | null>(null);
  protected readonly subtaskText = signal('');

  /** Ítems borrados que todavía se pueden recuperar (se ocultan, pero aún no se envían) */
  private readonly pendingDeletes = new Map<string, { item: ListItem; timer: ReturnType<typeof setTimeout> }>();
  private readonly hidden = signal<ReadonlySet<string>>(new Set());

  protected readonly addForm = this.fb.group({
    text: ['', [Validators.required, Validators.maxLength(200)]],
    amount: [''],
    unit: ['', Validators.maxLength(20)],
    category: ['', Validators.maxLength(40)],
    assigneeId: [''],
    dueDate: [''],
    dueTime: [''],
    reminderMode: ['default' as ReminderMode],
    reminderStart: [3],
    reminderEvery: [1],
  });
  protected readonly editForm = this.fb.group({
    text: ['', [Validators.required, Validators.maxLength(200)]],
    note: ['', Validators.maxLength(500)],
    amount: [''],
    unit: ['', Validators.maxLength(20)],
    category: ['', Validators.maxLength(40)],
    assigneeId: [''],
    dueDate: [''],
    dueTime: [''],
    reminderMode: ['default' as ReminderMode],
    reminderStart: [3],
    reminderEvery: [1],
  });

  private readonly visibleItems = computed(() => this.list().items.filter((i) => !this.hidden().has(i.id)));
  /** Tareas principales (las subtareas se muestran dentro de su tarea) */
  private readonly topLevel = computed(() => this.visibleItems().filter((i) => !i.parentId));
  private readonly subtasks = computed(() => {
    const byParent = new Map<string, ListItem[]>();
    for (const item of this.visibleItems()) {
      if (!item.parentId) continue;
      byParent.set(item.parentId, [...(byParent.get(item.parentId) ?? []), item]);
    }
    for (const subs of byParent.values()) subs.sort((a, b) => a.position - b.position);
    return byParent;
  });

  /** Pendientes en orden manual; en compras, agrupados por categoría */
  protected readonly groups = computed<Group[]>(() => {
    const pending = this.topLevel()
      .filter((i) => !i.completedAt)
      .sort((a, b) => a.position - b.position);
    if (!this.isShopping()) return [{ key: 'all', label: null, items: pending }];
    const byKey = new Map<string, Group>();
    for (const item of pending) {
      const label = item.category?.trim() || null;
      const key = label?.toLocaleLowerCase() ?? '';
      if (!byKey.has(key)) byKey.set(key, { key, label, items: [] });
      byKey.get(key)!.items.push(item);
    }
    // Alfabético, "sin categoría" al final
    return [...byKey.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key)));
  });

  /** Los completados bajan al final, el último marcado primero */
  protected readonly completed = computed(() =>
    this.topLevel()
      .filter((i) => i.completedAt)
      .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)),
  );

  protected readonly categories = computed(() => [
    ...new Set(this.list().items.map((i) => i.category?.trim()).filter((c): c is string => !!c)),
  ]);

  protected readonly pendingCount = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));

  /** Aviso al poner una fecha: "puedes llevar tus tareas a Google Calendar" (hasta conectarlo o pedir no verlo más) */
  private readonly promptClosed = signal(false);
  protected readonly calendarPrompt = computed(() => {
    const status = this.calendar.status();
    return !!status?.available && !status.connected && !this.auth.user()?.calendarPromptDismissed && !this.promptClosed();
  });

  constructor() {
    effect(() => {
      if (this.isTodo()) untracked(() => void this.calendar.load());
    });
  }

  dismissCalendarPrompt(forever: boolean): void {
    this.promptClosed.set(true);
    if (forever) void this.profile.setSettings({ calendarPromptDismissed: true }).catch(() => undefined);
  }

  ngOnDestroy(): void {
    // Al salir de la pantalla, los borrados pendientes se confirman
    for (const [id, { timer }] of this.pendingDeletes) {
      clearTimeout(timer);
      void this.store.deleteItem(this.list().id, id).catch(() => undefined);
    }
  }

  // ---------- Presentación ----------

  protected memberName(id: string | null): string | null {
    if (!id) return null;
    return this.members().find((m) => m.userId === id)?.nickname ?? null;
  }

  protected when(iso: string): string {
    const date = new Date(iso);
    const locale = this.i18n.locale();
    const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return this.i18n.t('lists.items.today', { time });
    if (date.toDateString() === yesterday.toDateString()) return this.i18n.t('lists.items.yesterday', { time });
    return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`;
  }

  protected dueLabel(item: ListItem) {
    return dueLabel(item, this.i18n);
  }

  protected subtasksOf(id: string): ListItem[] {
    return this.subtasks().get(id) ?? [];
  }

  /** Avance de una tarea con subtareas: "2/3" */
  protected progress(item: ListItem): { done: number; total: number } | null {
    if (item.parentId) return null;
    const subs = this.subtasksOf(item.id);
    return subs.length ? { done: subs.filter((s) => s.completedAt).length, total: subs.length } : null;
  }

  /** "2 L"; si es parcial, "1 de 2 L" */
  protected amountLabel(item: ListItem): string | null {
    if (item.amount === null) return null;
    const locale = this.i18n.locale();
    const of = [formatAmount(item.amount, locale), item.unit].filter(Boolean).join(' ');
    return isPartial(item) ? this.i18n.t('lists.purchase.partialTag', { done: formatAmount(item.purchased!, locale), of }) : of;
  }

  protected money(value: number): string {
    return formatMoney(value, this.list().currency, this.i18n.locale());
  }

  /** Cantidad escrita en el formulario: número positivo o vacío (acepta coma decimal) */
  private amountOf(raw: string | number | null): number | null {
    // input type=number entrega un número (o null si está vacío)
    const text = String(raw ?? '').trim();
    const value = Number(text.replace(',', '.'));
    return text && value > 0 ? value : null;
  }

  // ---------- Cambios locales ----------

  private patchItem(id: string, changes: Partial<ListItem>): void {
    this.list.update((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...changes } : i)) }));
    this.recount();
  }

  private recount(): void {
    this.list.update((l) => {
      const items = l.items.filter((i) => !this.hidden().has(i.id) && !this.hidden().has(i.parentId ?? ''));
      const tasks = items.filter((i) => !i.parentId);
      const completed = tasks.filter((i) => i.completedAt).length;
      const spent = items.reduce((sum, i) => sum + (i.spent ?? 0), 0);
      return {
        ...l,
        counts: { total: tasks.length, completed, pending: tasks.length - completed },
        spent: items.some((i) => i.spent !== null) ? Math.round(spent * 100) / 100 : null,
      };
    });
  }

  private fail(err: unknown): void {
    this.error.set(this.i18n.error(toApiError(err).code));
  }

  // ---------- Acciones ----------

  async add(): Promise<void> {
    if (this.addForm.invalid) return;
    const v = this.addForm.getRawValue();
    const item: NewItem = { text: v.text.trim() };
    if (this.isShopping()) Object.assign(item, this.shoppingFields(v));
    if (this.isTodo()) Object.assign(item, this.todoFields(v));
    this.addForm.reset({
      text: '',
      amount: '',
      unit: '',
      category: v.category,
      assigneeId: '',
      dueDate: '',
      dueTime: '',
      reminderMode: 'default',
      reminderStart: this.defaults().startDays,
      reminderEvery: this.defaults().everyDays,
    });
    this.error.set(null);
    await this.create(item);
  }

  private async create(item: NewItem): Promise<void> {
    try {
      const created = await this.store.addItem(this.list().id, item);
      // Una subtarea nueva reabre su tarea si estaba completa
      this.list.update((l) => ({ ...l, items: syncParent([...l.items.filter((i) => i.id !== created.id), created], created.parentId, this.me()) }));
      this.recount();
    } catch (err) {
      this.fail(err);
    }
  }

  startSubtask(item: ListItem): void {
    this.subtaskText.set('');
    this.addingSubtaskTo.set(item.id);
  }

  /** Agrega la subtarea y deja el campo listo para la siguiente */
  async addSubtask(parent: ListItem): Promise<void> {
    const text = this.subtaskText().trim();
    if (!text) return;
    this.subtaskText.set('');
    this.error.set(null);
    await this.create({ text, parentId: parent.id });
  }

  private shoppingFields(v: { amount: string | number | null; unit: string; category: string }): ItemChanges {
    const amount = this.amountOf(v.amount);
    return { amount, unit: amount !== null ? v.unit.trim() || null : null, category: v.category.trim() || null };
  }

  /** La hora solo cuenta si hay fecha; los recordatorios, "como en el perfil", personalizados o apagados */
  private todoFields(v: {
    assigneeId: string;
    dueDate: string;
    dueTime: string;
    reminderMode: ReminderMode;
    reminderStart: number;
    reminderEvery: number;
  }): ItemChanges {
    const dueDate = v.dueDate || null;
    const custom = v.reminderMode === 'custom';
    return {
      assigneeId: v.assigneeId || null,
      dueDate,
      dueTime: dueDate ? v.dueTime || null : null,
      remindersOff: v.reminderMode === 'off',
      reminderStartDays: custom ? clamp(v.reminderStart, 0, 60) : null,
      reminderEveryDays: custom ? clamp(v.reminderEvery, 1, 30) : null,
    };
  }

  private me() {
    const me = this.auth.user();
    return me ? { id: me.id, nickname: me.nickname } : null;
  }

  /** En compras, marcar abre "¿Cuánto compraste?"; desmarcar un comprado lo vuelve a pendiente. */
  async toggle(item: ListItem): Promise<void> {
    if (!this.canCheck()) return;
    if (this.isShopping() && !item.completedAt) {
      this.buying.set(item);
      return;
    }
    const completed = !item.completedAt;
    // Completar una tarea con subtareas pendientes las completa todas: se pide confirmación
    const pendingSubs = completed && !item.parentId ? this.subtasksOf(item.id).filter((s) => !s.completedAt).length : 0;
    if (pendingSubs) {
      const ok = await this.confirm.ask({
        title: this.i18n.t('lists.subtasks.confirmTitle', { task: item.text }),
        message: this.i18n.t('lists.subtasks.confirmBody', { n: pendingSubs }),
        confirmLabel: this.i18n.t('lists.subtasks.confirm'),
        cancelLabel: this.i18n.t('lists.items.cancel'),
      });
      if (!ok) return;
    }
    await this.setCompleted(item, completed);
  }

  private async setCompleted(item: ListItem, completed: boolean): Promise<void> {
    const before = this.list().items;
    // Al instante en pantalla (con su tarea y subtareas); la respuesta trae el autor y la hora reales
    this.list.update((l) => ({ ...l, items: applyToggle(l.items, item.id, completed, this.me()) }));
    this.recount();
    try {
      this.patchItem(item.id, await this.store.setCompleted(this.list().id, item.id, completed));
    } catch (err) {
      this.list.update((l) => ({ ...l, items: before }));
      this.recount();
      this.fail(err);
    }
  }

  async purchase(item: ListItem, input: PurchaseInput): Promise<void> {
    this.patchItem(item.id, applyPurchase(item, input.amount, input.spent, this.me()));
    try {
      this.patchItem(item.id, await this.store.purchase(this.list().id, item.id, input));
    } catch (err) {
      this.patchItem(item.id, item);
      this.fail(err);
    }
  }

  /** "Quitar lo comprado" desde el diálogo */
  clearPurchase(item: ListItem): void {
    void this.setCompleted(item, false);
  }

  startEdit(item: ListItem): void {
    if (!this.canEdit()) return;
    this.editForm.setValue({
      text: item.text,
      note: item.note ?? '',
      amount: item.amount === null ? '' : String(item.amount),
      unit: item.unit ?? '',
      category: item.category ?? '',
      assigneeId: item.assigneeId ?? '',
      dueDate: item.dueDate ?? '',
      dueTime: item.dueTime ?? '',
      reminderMode: item.reminders?.off ? 'off' : item.reminders?.startDays !== null && item.reminders?.startDays !== undefined ? 'custom' : 'default',
      reminderStart: item.reminders?.startDays ?? this.defaults().startDays,
      reminderEvery: item.reminders?.everyDays ?? this.defaults().everyDays,
    });
    this.editingId.set(item.id);
  }

  async saveEdit(item: ListItem): Promise<void> {
    if (this.editForm.invalid) return;
    const v = this.editForm.getRawValue();
    const changes: ItemChanges = { text: v.text.trim(), note: v.note.trim() || null };
    if (this.isShopping()) Object.assign(changes, this.shoppingFields(v));
    if (this.isTodo()) Object.assign(changes, this.todoFields(v));
    this.editingId.set(null);
    this.patchItem(item.id, { ...changes, dueAt: changes.dueDate && changes.dueTime ? new Date(`${changes.dueDate}T${changes.dueTime}`).toISOString() : null });
    try {
      this.patchItem(item.id, await this.store.updateItem(this.list().id, item.id, changes));
    } catch (err) {
      this.patchItem(item.id, item);
      this.fail(err);
    }
  }

  /** Borrar con "Deshacer": se oculta al instante y se envía cuando pasan 5 segundos. */
  remove(item: ListItem): void {
    this.editingId.set(null);
    const listId = this.list().id;
    const timer = setTimeout(() => {
      this.pendingDeletes.delete(item.id);
      this.store
        .deleteItem(listId, item.id)
        .then(() => this.list.update((l) => ({ ...l, items: removeItem(l.items, item.id, this.me()) })))
        .catch((err) => {
          this.unhide(item.id);
          this.fail(err);
        });
    }, UNDO_MS);
    this.pendingDeletes.set(item.id, { item, timer });
    this.hidden.update((s) => new Set(s).add(item.id));
    this.recount();
    this.toast.show(this.i18n.t('lists.items.deleted'), {
      actionLabel: this.i18n.t('lists.detail.undo'),
      durationMs: UNDO_MS,
      action: () => {
        clearTimeout(this.pendingDeletes.get(item.id)?.timer);
        this.pendingDeletes.delete(item.id);
        this.unhide(item.id);
      },
    });
  }

  private unhide(id: string): void {
    this.hidden.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    this.recount();
  }

  /** Orden manual: el ítem toma una posición entre sus nuevos vecinos (solo cambia él) */
  async drop(event: CdkDragDrop<ListItem[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) return;
    const items = [...event.container.data];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    const i = event.currentIndex;
    const before = items[i - 1]?.position;
    const after = items[i + 1]?.position;
    const position =
      before !== undefined && after !== undefined ? (before + after) / 2 : before !== undefined ? before + 1 : after! - 1;
    const item = items[i]!;
    this.patchItem(item.id, { position });
    try {
      await this.store.updateItem(this.list().id, item.id, { position });
    } catch (err) {
      this.patchItem(item.id, { position: item.position });
      this.fail(err);
    }
  }

  async reset(): Promise<void> {
    const n = this.completed().length;
    const ok = await this.confirm.ask({
      title: this.i18n.t('lists.items.resetTitle'),
      message: this.i18n.t('lists.items.resetBody', { n }),
      confirmLabel: this.i18n.t('lists.items.resetConfirm'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
    });
    if (!ok) return;
    try {
      this.list.set(await this.store.uncheckAll(this.list().id));
    } catch (err) {
      this.fail(err);
    }
  }

  async clearCompleted(): Promise<void> {
    const n = this.completed().length;
    const ok = await this.confirm.ask({
      title: this.i18n.t('lists.items.clearTitle'),
      message: this.i18n.t('lists.items.clearBody', { n }),
      confirmLabel: this.i18n.t('lists.items.clearConfirm'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      this.list.set(await this.store.deleteCompleted(this.list().id));
    } catch (err) {
      this.fail(err);
    }
  }
}
