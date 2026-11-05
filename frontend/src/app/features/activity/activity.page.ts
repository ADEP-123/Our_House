import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FamiliesService } from '../families/families.service';
import { formatAmount, formatMoney } from '../lists/item-logic';
import { ActivityEntry, ActivityFilters, ActivityService } from './activity.service';

interface Day {
  key: string;
  label: string;
  entries: ActivityEntry[];
}

/** Bitácora del grupo (solo líderes): filtros por lista, persona y fechas, agrupada por día. */
@Component({
  selector: 'oh-activity-page',
  imports: [FormsModule, RouterLink, TPipe],
  templateUrl: './activity.page.html',
  styleUrl: './activity.page.scss',
})
export class ActivityPage implements OnInit {
  /** :id del grupo */
  readonly id = input.required<string>();

  private readonly api = inject(ActivityService);
  private readonly families = inject(FamiliesService);
  private readonly i18n = inject(I18n);
  /** Moneda del grupo, para mostrar lo pagado en las compras */
  private readonly currency = computed(() => this.families.families()?.find((f) => f.id === this.id())?.currency ?? 'USD');

  protected readonly familyName = signal('');
  protected readonly entries = signal<ActivityEntry[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly options = signal<{ lists: { id: string; name: string | null }[]; actors: { id: string; nickname: string }[] }>({
    lists: [],
    actors: [],
  });
  protected filters: ActivityFilters = {};

  protected readonly days = computed<Day[]>(() => {
    const days: Day[] = [];
    for (const entry of this.entries()) {
      const date = new Date(entry.createdAt);
      const key = date.toDateString();
      if (days.at(-1)?.key !== key) days.push({ key, label: this.dayLabel(date), entries: [] });
      days.at(-1)!.entries.push(entry);
    }
    return days;
  });

  async ngOnInit(): Promise<void> {
    this.families
      .detail(this.id())
      .then((f) => this.familyName.set(f.name))
      .catch(() => undefined);
    this.api
      .filters(this.id())
      .then((o) => this.options.set(o))
      .catch(() => undefined);
    await this.load();
  }

  async load(more = false): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.page(this.id(), this.filters, more ? this.cursor() ?? undefined : undefined);
      this.entries.update((current) => (more ? [...current, ...page.entries] : page.entries));
      this.cursor.set(page.nextCursor);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.loading.set(false);
    }
  }

  clearFilters(): void {
    this.filters = {};
    void this.load();
  }

  protected hasFilters(): boolean {
    return Object.values(this.filters).some(Boolean);
  }

  private dayLabel(date: Date): string {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return this.i18n.t('activity.today');
    if (date.toDateString() === yesterday.toDateString()) return this.i18n.t('activity.yesterday');
    return date.toLocaleDateString(this.i18n.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  protected time(entry: ActivityEntry): string {
    return new Date(entry.createdAt).toLocaleTimeString(this.i18n.locale(), { hour: 'numeric', minute: '2-digit' });
  }

  protected listOptionLabel(list: { name: string | null }): string {
    return list.name ?? this.i18n.t('activity.privateList');
  }

  /** Frase de cada registro, en el idioma del usuario */
  protected sentence(e: ActivityEntry): string {
    let key = e.action.replace('.', '_');
    if (e.action === 'list.privacy_changed') key = e.details?.['isPrivate'] ? 'list_privacy_private' : 'list_privacy_public';
    const template = `activity.actions.${key}` as TranslationKey;
    const known = this.i18n.t(template) !== template;
    return this.i18n.t(known ? template : 'activity.actions.unknown', {
      actor: e.actor?.nickname ?? this.i18n.t('activity.system'),
      // Los nombres reales van entre comillas; los ocultos no ("una lista privada")
      list: e.list?.name ? this.i18n.t('activity.listNamed', { name: e.list.name }) : this.i18n.t('activity.privateList'),
      item: e.item?.text ? this.quote(e.item.text) : this.i18n.t('activity.anItem'),
      owner: e.owner?.nickname ?? '',
      n: Number(e.details?.['count'] ?? 0),
      days: Number(e.details?.['days'] ?? 0),
      source: this.quote(String(e.details?.['sourceName'] ?? '')),
    });
  }

  private quote(text: string): string {
    return this.i18n.t('activity.quote', { text });
  }

  /** Detalle de qué cambió (ediciones) */
  protected detail(e: ActivityEntry): string | null {
    if (e.hidden || !e.details) return null;
    const field = (name: string) => this.i18n.t(`activity.fields.${name}` as TranslationKey);
    if (e.action === 'list.updated') {
      const changes = e.details['changes'] as Record<string, { from: string; to: string }>;
      const parts = Object.entries(changes).map(([k, c]) => (k === 'name' ? this.i18n.t('activity.renamed', c) : field(k)));
      return this.i18n.t('activity.changed', { fields: parts.join(', ') });
    }
    if (e.action === 'item.updated') {
      const fields = [...new Set((e.details['fields'] as string[]).map((k) => (k.startsWith('reminder') ? 'reminderStartDays' : k)))].map((k) =>
        k === 'text' ? `${field(k)} (${this.i18n.t('activity.previously', { text: String(e.details!['previousText']) })})` : field(k),
      );
      return this.i18n.t('activity.changed', { fields: fields.join(', ') });
    }
    if (e.details['bySubtasks']) return this.i18n.t('activity.bySubtasks');
    if (e.details['subtasks']) return this.i18n.t('activity.withSubtasks', { n: Number(e.details['subtasks']) });
    if (e.details['subtaskOf']) return this.i18n.t('activity.asSubtask');
    if (e.action === 'item.purchased') {
      const d = e.details;
      const locale = this.i18n.locale();
      const parts: string[] = [];
      if (d['of'] !== null && d['of'] !== undefined) {
        const unit = d['unit'] ? ` ${String(d['unit'])}` : '';
        parts.push(`${formatAmount(Number(d['amount']), locale)}${unit}`);
        if (!d['complete']) parts.push(this.i18n.t('activity.partial', { done: formatAmount(Number(d['total']), locale), of: `${formatAmount(Number(d['of']), locale)}${unit}` }));
      }
      if (d['spent'] !== null && d['spent'] !== undefined) parts.push(formatMoney(Number(d['spent']), this.currency(), locale));
      return parts.join(' · ') || null;
    }
    return null;
  }
}
