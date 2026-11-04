import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ConfirmService } from '../../shared/confirm.service';
import { FamiliesService } from '../families/families.service';
import { ListCardComponent } from './list-card.component';
import { ListFormComponent } from './list-form.component';
import { LIST_TYPES, ListType } from './list-presets';
import { FamilyLists, ListInput } from './lists.models';
import { ListsStore } from './lists.store';

@Component({
  selector: 'oh-lists-page',
  imports: [RouterLink, TPipe, ListCardComponent, ListFormComponent],
  templateUrl: './lists.page.html',
  styleUrl: './lists.page.scss',
})
export class ListsPage implements OnInit {
  protected readonly families = inject(FamiliesService);
  private readonly store = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18n);
  private readonly sync = inject(SyncStatus);

  protected readonly types = LIST_TYPES;
  protected readonly family = this.families.active;
  protected readonly data = signal<FamilyLists | null>(null);
  protected readonly filter = signal<ListType | 'all'>('all');
  protected readonly archived = signal(false);
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly visible = computed(() => {
    const lists = this.data()?.lists ?? [];
    const filter = this.filter();
    return filter === 'all' ? lists : lists.filter((l) => l.type === filter);
  });

  constructor() {
    // Recarga al cambiar de grupo activo o entre activas / archivadas
    effect(() => {
      const family = this.family();
      const archived = this.archived();
      if (family) untracked(() => void this.load(family.id, archived));
    });

    // Resúmenes al día: cada 15 segundos y al volver a la app
    const refresh = () => {
      const family = this.family();
      const idle = !this.creating() && this.sync.queued() === 0;
      if (family && document.visibilityState === 'visible' && idle) void this.load(family.id, this.archived());
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
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
  }

  async load(familyId: string, archived: boolean): Promise<void> {
    try {
      this.data.set(await this.store.familyLists(familyId, archived));
      this.error.set(null);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    }
  }

  async create(input: ListInput): Promise<void> {
    const family = this.family();
    if (!family) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const list = await this.store.create(family.id, input);
      this.creating.set(false);
      await this.router.navigate(['/listas', list.id]);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }

  /** Aviso de privacidad antes de abrir la lista privada de un miembro supervisado */
  async openSupervised(id: string, owner: string): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.i18n.t('lists.supervised.confirmTitle'),
      message: this.i18n.t('lists.supervised.confirmBody', { name: owner }),
      confirmLabel: this.i18n.t('lists.supervised.confirm'),
      cancelLabel: this.i18n.t('lists.form.cancel'),
    });
    if (ok) await this.router.navigate(['/listas', id], { queryParams: { supervision: 1 } });
  }
}
