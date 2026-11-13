import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamilyMember } from '../families/families.service';
import {
  applyPurchase,
  applyToggle,
  formatAmount,
  formatMoney,
  isPartial,
  linkify,
  removeItem,
  rolledOver,
  syncParent,
} from './item-logic';
import { dueLabel, repeatLabel, shortDate } from './due-label';
import { DEFAULT_FEATURES, ListFeature } from './list-presets';
import { ListPaymentsService } from './list-payments.service';
import { ListDetail, ListItem } from './lists.models';
import { ItemEditorComponent, ItemEditorResult } from './item-editor.component';
import { PurchaseDialogComponent, PurchaseInput } from './purchase-dialog.component';
import { ListsStore, NewItem } from './lists.store';

interface Group {
  key: string;
  label: string | null;
  items: ListItem[];
}

const UNDO_MS = 5000;

/** Checklist de una lista: agregar, marcar, editar, reordenar, borrar con deshacer, reiniciar y limpiar. */
@Component({
  selector: 'oh-list-items',
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    TPipe,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    PurchaseDialogComponent,
    ItemEditorComponent,
  ],
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
  private readonly payments = inject(ListPaymentsService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly canEdit = computed(() => this.list().permissions.canEdit);
  protected readonly canCheck = computed(() => this.list().permissions.canCheck);
  /** Opciones activas de la lista (una copia guardada antes de existir las opciones usa las de su tipo) */
  private readonly features = computed<ReadonlySet<ListFeature>>(
    () => new Set(this.list().features ?? DEFAULT_FEATURES[this.list().type]),
  );
  protected readonly has = (feature: ListFeature) => this.features().has(feature);
  protected readonly error = signal<string | null>(null);
  /** Ítem de compras cuyo diálogo "¿Cuánto compraste?" está abierto */
  protected readonly buying = signal<ListItem | null>(null);
  protected readonly isPartial = isPartial;
  /** Tarea en la que se está escribiendo una subtarea */
  protected readonly addingSubtaskTo = signal<string | null>(null);
  protected readonly subtaskText = signal('');

  /** Ítems borrados que todavía se pueden recuperar (se ocultan, pero aún no se envían) */
  private readonly pendingDeletes = new Map<
    string,
    { item: ListItem; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly hidden = signal<ReadonlySet<string>>(new Set());

  /** Campo rápido: solo el título */
  protected readonly addForm = this.fb.group({
    text: ['', [Validators.required, Validators.maxLength(200)]],
  });
  /** Ventana de detalles abierta: elemento a editar (null = nuevo), título ya escrito o tarea de la subtarea */
  protected readonly editor = signal<{
    item: ListItem | null;
    text: string;
    parentId: string | null;
  } | null>(null);
  /** Descripciones abiertas con "ver más" */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly linkify = linkify;

  private readonly visibleItems = computed(() =>
    this.list().items.filter((i) => !this.hidden().has(i.id)),
  );
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
    if (!this.has('category')) return [{ key: 'all', label: null, items: pending }];
    const byKey = new Map<string, Group>();
    for (const item of pending) {
      const label = item.category?.trim() || null;
      const key = label?.toLocaleLowerCase() ?? '';
      if (!byKey.has(key)) byKey.set(key, { key, label, items: [] });
      byKey.get(key)!.items.push(item);
    }
    // Alfabético, "sin categoría" al final
    return [...byKey.values()].sort((a, b) =>
      a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key),
    );
  });

  /** Los completados bajan al final, el último marcado primero */
  protected readonly completed = computed(() =>
    this.topLevel()
      .filter((i) => i.completedAt)
      .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)),
  );

  protected readonly categories = computed(() => [
    ...new Set(
      this.list()
        .items.map((i) => i.category?.trim())
        .filter((c): c is string => !!c),
    ),
  ]);

  protected readonly pendingCount = computed(() =>
    this.groups().reduce((n, g) => n + g.items.length, 0),
  );

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
    if (date.toDateString() === today.toDateString())
      return this.i18n.t('lists.items.today', { time });
    if (date.toDateString() === yesterday.toDateString())
      return this.i18n.t('lists.items.yesterday', { time });
    return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`;
  }

  protected dueLabel(item: ListItem) {
    return dueLabel(item, this.i18n);
  }

  /** "Cada semana · lun, jue"; si está hecha y vuelve sola, cuándo */
  protected repeatTag(item: ListItem): string | null {
    if (!item.repeat || !this.has('repeat')) return null;
    const label = repeatLabel(item.repeat, this.i18n);
    return item.completedAt && item.reopenOn
      ? `${label} · ${this.i18n.t('lists.repeat.returns', { date: shortDate(item.reopenOn, this.i18n) })}`
      : label;
  }

  /** "👤 Ana" o, con turnos, "turno de Ana" */
  protected assigneeTag(item: ListItem): string | null {
    const name = this.memberName(item.assigneeId);
    if (!name) return null;
    return item.rotation?.length ? this.i18n.t('lists.repeat.turnTag', { name }) : name;
  }

  protected subtasksOf(id: string): ListItem[] {
    return this.subtasks().get(id) ?? [];
  }

  /** Avance de una tarea con subtareas: "2/3" */
  protected progress(item: ListItem): { done: number; total: number } | null {
    if (item.parentId) return null;
    const subs = this.subtasksOf(item.id);
    return subs.length
      ? { done: subs.filter((s) => s.completedAt).length, total: subs.length }
      : null;
  }

  /** "2 L"; si es parcial, "1 de 2 L" */
  protected amountLabel(item: ListItem): string | null {
    if (item.amount === null) return null;
    const locale = this.i18n.locale();
    const of = [formatAmount(item.amount, locale), item.unit].filter(Boolean).join(' ');
    return isPartial(item)
      ? this.i18n.t('lists.purchase.partialTag', {
          done: formatAmount(item.purchased!, locale),
          of,
        })
      : of;
  }

  protected money(value: number): string {
    return formatMoney(value, this.list().currency, this.i18n.locale());
  }

  // ---------- Cambios locales ----------

  private patchItem(id: string, changes: Partial<ListItem>): void {
    this.list.update((l) => ({
      ...l,
      items: l.items.map((i) => (i.id === id ? { ...i, ...changes } : i)),
    }));
    this.recount();
  }

  private recount(): void {
    this.list.update((l) => {
      const items = l.items.filter(
        (i) => !this.hidden().has(i.id) && !this.hidden().has(i.parentId ?? ''),
      );
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
    const text = this.addForm.getRawValue().text.trim();
    this.addForm.reset({ text: '' });
    this.error.set(null);
    await this.create({ text });
  }

  /** "Con detalles": abre la ventana con el título que ya se haya escrito */
  openNew(): void {
    const text = this.addForm.getRawValue().text.trim();
    this.addForm.reset({ text: '' });
    this.editor.set({ item: null, text, parentId: null });
  }

  private async create(item: NewItem): Promise<ListItem | null> {
    try {
      const created = await this.store.addItem(this.list().id, item);
      // Una subtarea nueva reabre su tarea si estaba completa
      this.list.update((l) => ({
        ...l,
        items: syncParent(
          [...l.items.filter((i) => i.id !== created.id), created],
          created.parentId,
          this.me(),
        ),
      }));
      this.recount();
      return created;
    } catch (err) {
      this.fail(err);
      return null;
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

  private me() {
    const me = this.auth.user();
    return me ? { id: me.id, nickname: me.nickname } : null;
  }

  /** En compras, marcar abre "¿Cuánto compraste?"; desmarcar un comprado lo vuelve a pendiente. */
  async toggle(item: ListItem): Promise<void> {
    if (!this.canCheck()) return;
    if (this.has('purchases') && !item.completedAt) {
      this.buying.set(item);
      return;
    }
    const completed = !item.completedAt;
    // Completar una tarea con subtareas pendientes las completa todas: se pide confirmación
    const pendingSubs =
      completed && !item.parentId
        ? this.subtasksOf(item.id).filter((s) => !s.completedAt).length
        : 0;
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
    // Ya está en un pago registrado: desmarcarlo lo descuenta del movimiento en finanzas
    if (!completed && this.payments.isPaid(item.id)) {
      const ok = await this.confirm.ask({
        title: this.i18n.t('lists.payment.uncheckTitle', { text: item.text }),
        message: this.i18n.t('lists.payment.uncheckBody'),
        confirmLabel: this.i18n.t('lists.payment.uncheckConfirm'),
        cancelLabel: this.i18n.t('lists.items.cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    const before = this.list().items;
    // Al instante en pantalla (con su tarea y subtareas); la respuesta trae el autor y la hora reales
    this.list.update((l) => ({ ...l, items: applyToggle(l.items, item.id, completed, this.me()) }));
    this.recount();
    try {
      const after = await this.store.setCompleted(this.list().id, item.id, completed);
      this.patchItem(item.id, after);
      this.refreshPayments();
      if (completed) await this.afterDone(item, after);
    } catch (err) {
      this.list.update((l) => ({ ...l, items: before }));
      this.recount();
      this.fail(err);
    }
  }

  async purchase(item: ListItem, input: PurchaseInput): Promise<void> {
    this.patchItem(item.id, applyPurchase(item, input.amount, input.spent, this.me()));
    try {
      const after = await this.store.purchase(this.list().id, item.id, input);
      this.patchItem(item.id, after);
      this.refreshPayments();
      await this.afterDone(item, after);
    } catch (err) {
      this.patchItem(item.id, item);
      this.fail(err);
    }
  }

  /**
   * Lo que se repite pasa a su siguiente vez en el servidor: se avisa la próxima fecha y, si tiene
   * subtareas (o es una subtarea que completó a su tarea), se trae la lista con todo desmarcado.
   */
  private async afterDone(before: ListItem, after: ListItem): Promise<void> {
    const parent = before.parentId ? this.list().items.find((i) => i.id === before.parentId) : null;
    if (parent?.repeat) {
      const fresh = await this.store.detail(this.list().id);
      const rolled = fresh.items.find((i) => i.id === parent.id);
      this.list.set(fresh);
      if (rolled && rolledOver(parent, rolled)) this.announceRoll(rolled);
      return;
    }
    if (!rolledOver(before, after)) return;
    this.announceRoll(after);
    if (this.subtasksOf(after.id).length) this.list.set(await this.store.detail(this.list().id));
  }

  private announceRoll(item: ListItem, skipped = false): void {
    const date = shortDate((item.reopenOn ?? item.dueDate)!, this.i18n);
    const key = skipped ? 'skipped' : item.reopenOn ? 'backOn' : 'done';
    this.toast.show(this.i18n.t(`lists.repeat.${key}`, { date }));
  }

  /** Saltar esta vez: pasa a la siguiente fecha sin contar como hecha */
  async skip(item: ListItem): Promise<void> {
    this.error.set(null);
    try {
      const after = await this.store.skip(this.list().id, item.id);
      this.patchItem(item.id, after);
      this.announceRoll(after, true);
    } catch (err) {
      this.fail(err);
    }
  }

  /** "Quitar lo comprado" desde el diálogo */
  clearPurchase(item: ListItem): void {
    void this.setCompleted(item, false);
  }

  /** Tocar el texto abre la ventana con todos sus datos */
  startEdit(item: ListItem): void {
    if (!this.canEdit()) return;
    this.editor.set({ item, text: item.text, parentId: item.parentId });
  }

  /** Guardar desde la ventana: crea (con sus subtareas) o edita */
  async saveEditor(
    item: ListItem | null,
    parentId: string | null,
    result: ItemEditorResult,
  ): Promise<void> {
    this.error.set(null);
    if (!item) {
      const created = await this.create({ ...result.changes, parentId });
      if (created)
        for (const text of result.subtasks) await this.create({ text, parentId: created.id });
      return;
    }
    const changes = result.changes;
    this.patchItem(item.id, {
      ...changes,
      dueAt:
        changes.dueDate && changes.dueTime
          ? new Date(`${changes.dueDate}T${changes.dueTime}`).toISOString()
          : null,
    });
    try {
      this.patchItem(item.id, await this.store.updateItem(this.list().id, item.id, changes));
    } catch (err) {
      this.patchItem(item.id, item);
      this.fail(err);
    }
  }

  toggleExpanded(id: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Borrar con "Deshacer": se oculta al instante y se envía cuando pasan 5 segundos. */
  remove(item: ListItem): void {
    const listId = this.list().id;
    const timer = setTimeout(() => {
      this.pendingDeletes.delete(item.id);
      this.store
        .deleteItem(listId, item.id)
        .then(() =>
          this.list.update((l) => ({ ...l, items: removeItem(l.items, item.id, this.me()) })),
        )
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
      before !== undefined && after !== undefined
        ? (before + after) / 2
        : before !== undefined
          ? before + 1
          : after! - 1;
    const item = items[i]!;
    this.patchItem(item.id, { position });
    try {
      await this.store.updateItem(this.list().id, item.id, { position });
    } catch (err) {
      this.patchItem(item.id, { position: item.position });
      this.fail(err);
    }
  }

  /** Lo pendiente de registrar cambió (compras) */
  private refreshPayments(): void {
    if (this.has('purchases')) void this.payments.refresh();
  }

  async reset(): Promise<void> {
    const n = this.completed().length;
    const paid = this.list().items.filter((i) => this.payments.isPaid(i.id)).length;
    const ok = await this.confirm.ask({
      title: this.i18n.t('lists.items.resetTitle'),
      message: this.i18n.t('lists.items.resetBody', { n }) + (paid ? this.i18n.t('lists.payment.resetPaid', { n: paid }) : ''),
      confirmLabel: this.i18n.t('lists.items.resetConfirm'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
    });
    if (!ok) return;
    try {
      this.list.set(await this.store.uncheckAll(this.list().id));
      this.refreshPayments();
    } catch (err) {
      this.fail(err);
    }
  }

  async clearCompleted(): Promise<void> {
    const n = this.completed().length;
    // Lo pagado de esos ítems que todavía no se registró ya no se podrá registrar
    const done = new Set(this.completed().map((i) => i.id));
    const unregistered = (this.payments.data()?.items ?? []).some((i) => done.has(i.id));
    const ok = await this.confirm.ask({
      title: this.i18n.t('lists.items.clearTitle'),
      message: this.i18n.t('lists.items.clearBody', { n }) + (unregistered ? this.i18n.t('lists.payment.clearUnregistered') : ''),
      confirmLabel: this.i18n.t('lists.items.clearConfirm'),
      cancelLabel: this.i18n.t('lists.items.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      this.list.set(await this.store.deleteCompleted(this.list().id));
      this.refreshPayments();
    } catch (err) {
      this.fail(err);
    }
  }
}
