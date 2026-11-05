import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { FamiliesService, FamilyMember } from '../families/families.service';
import { ListFormComponent } from './list-form.component';
import { ListItemsComponent } from './list-items.component';
import { SecretListComponent } from './secret-list.component';
import { formatMoney } from './item-logic';
import { colorOf, iconOf, LIST_TYPES } from './list-presets';
import { ListDetail, ListInput } from './lists.models';
import { ListsStore } from './lists.store';

@Component({
  selector: 'oh-list-page',
  imports: [RouterLink, TPipe, ListFormComponent, ListItemsComponent, SecretListComponent],
  templateUrl: './list.page.html',
  styleUrl: './list.page.scss',
})
export class ListPage implements OnInit {
  /** :id de la ruta */
  readonly id = input.required<string>();
  /** ?supervision=1: el líder ya aceptó el aviso de privacidad */
  readonly supervision = input<string | undefined>();

  private readonly store = inject(ListsStore);
  private readonly families = inject(FamiliesService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly sync = inject(SyncStatus);
  protected readonly i18n = inject(I18n);

  protected readonly list = signal<ListDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly members = signal<FamilyMember[]>([]);

  protected readonly color = computed(() => colorOf(this.list()?.color ?? 'blue'));
  protected readonly icon = computed(() => iconOf(this.list()?.icon ?? 'check'));
  protected readonly typeLabel = computed(() => LIST_TYPES.find((t) => t.id === this.list()?.type)?.label ?? 'lists.types.other');
  protected readonly myRole = computed(() => this.families.families()?.find((f) => f.id === this.list()?.familyId)?.role);

  constructor() {
    // Mientras la pantalla está abierta, trae los cambios de los demás cada 15 segundos
    // y al volver a la app. No pisa cambios propios que aún se están enviando.
    const refresh = () => {
      const idle = this.store.pending() === 0 && this.sync.queued() === 0 && !this.editing();
      if (document.visibilityState === 'visible' && idle) void this.reload(true);
    };
    // Al terminar de enviar los cambios hechos sin conexión, se trae la versión del servidor
    effect(() => {
      if (this.store.synced() > 0) untracked(() => refresh());
    });
    const timer = setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.families.families() === null) void this.families.load().catch(() => undefined);
    await this.reload();
    const familyId = this.list()?.familyId;
    if (familyId) {
      // Nombres para "responsable" y para elegir a quién asignar
      this.families
        .detail(familyId)
        .then((f) => this.members.set(f.members))
        .catch(() => undefined);
    }
  }

  /** silent: actualización automática; un error no reemplaza la pantalla */
  protected async reload(silent = false): Promise<void> {
    try {
      this.list.set(await this.store.detail(this.id(), !!this.supervision()));
      this.error.set(null);
    } catch (err) {
      if (!silent || !this.list()) this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  protected money(value: number): string {
    return formatMoney(value, this.list()?.currency ?? 'USD', this.i18n.locale());
  }

  protected formatDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString(this.i18n.locale(), { day: 'numeric', month: 'long' }) : '';
  }

  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    this.error.set(null);
    try {
      return await work();
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  async save(changes: ListInput): Promise<void> {
    const { type: _type, ...editable } = changes;
    const updated = await this.run(() => this.store.update(this.id(), editable));
    if (updated) {
      this.list.set(updated);
      this.editing.set(false);
    }
  }

  async togglePin(): Promise<void> {
    const list = this.list()!;
    const updated = await this.run(() => this.store.setPinned(list.id, !list.pinned));
    if (updated) this.list.set({ ...list, pinned: updated.pinned });
  }

  async duplicate(): Promise<void> {
    const list = this.list()!;
    const name = this.i18n.t('lists.detail.copyName', { name: list.name }).slice(0, 80);
    const copy = await this.run(() => this.store.duplicate(list.id, name));
    if (copy) {
      this.toast.show(this.i18n.t('lists.detail.duplicated'));
      await this.router.navigate(['/listas', copy.id]);
      this.list.set(copy);
    }
  }

  /** Archivar con "Deshacer": la lista sigue recuperable desde Archivadas durante el plazo de borrado. */
  async archive(): Promise<void> {
    const id = this.id();
    const done = await this.run(() => this.store.setArchived(id, true));
    if (!done) return;
    this.toast.show(this.i18n.t('lists.detail.archivedToast'), {
      actionLabel: this.i18n.t('lists.detail.undo'),
      action: () => void this.store.setArchived(id, false).then(() => this.router.navigate(['/listas', id])),
    });
    await this.router.navigate(['/listas']);
  }

  async restore(): Promise<void> {
    const updated = await this.run(() => this.store.setArchived(this.id(), false));
    if (updated) {
      this.list.set(updated);
      this.toast.show(this.i18n.t('lists.detail.restored'));
    }
  }

  /** Lista secreta borrada desde su pantalla */
  afterDelete(): void {
    this.toast.show(this.i18n.t('secrets.listDeleted'));
    void this.router.navigate(['/listas']);
  }

  async deleteForever(): Promise<void> {
    const list = this.list()!;
    const ok = await this.confirm.ask({
      title: this.i18n.t('lists.detail.deleteTitle'),
      message: this.i18n.t('lists.detail.deleteBody', { name: list.name }),
      confirmLabel: this.i18n.t('lists.detail.deleteForever'),
      cancelLabel: this.i18n.t('lists.form.cancel'),
      danger: true,
    });
    if (!ok) return;
    const done = await this.run(async () => {
      await this.store.remove(list.id);
      return true;
    });
    if (done) await this.router.navigate(['/listas']);
  }
}
