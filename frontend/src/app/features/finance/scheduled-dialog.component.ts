import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { WEEK_ORDER, weekdayNames } from '../lists/item-logic';
import { iconOf } from '../lists/list-presets';
import { localToday } from './finance-logic';
import {
  Account,
  Category,
  Scheduled,
  ScheduledInput,
  ScheduledKind,
  ScheduledRule,
  SavingsProject,
} from './finance.models';
import { FinanceStore } from './finance.store';
import { amountForInput, parseAmount } from './movement-logic';
import { SavingsService } from './savings.service';
import { dayPassed, monthlyStart } from './scheduled-logic';
import { ScheduledService } from './scheduled.service';

type Freq = ScheduledRule['freq'];

/** Datos para empezar un programado nuevo (ej. desde una sugerencia) */
export interface ScheduledPrefill {
  accountId?: string;
  description?: string;
  categoryId?: string | null;
  amount?: number;
  day?: number;
}

/**
 * Crear o editar un movimiento programado: qué se registra (salida, entrada, transferencia o apartado),
 * cada cuánto, desde cuándo, hasta cuándo, si se registra solo o se confirma, y los avisos.
 */
@Component({
  selector: 'oh-scheduled-dialog',
  imports: [TPipe],
  templateUrl: './scheduled-dialog.component.html',
  styleUrl: './scheduled-dialog.component.scss',
})
export class ScheduledDialogComponent {
  readonly familyId = input.required<string>();
  readonly saved = output<void>();

  private readonly store = inject(FinanceStore);
  private readonly savings = inject(SavingsService);
  private readonly scheduled = inject(ScheduledService);
  private readonly i18n = inject(I18n);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly iconOf = iconOf;
  protected readonly kinds: ScheduledKind[] = ['out', 'in', 'transfer', 'set_aside'];
  protected readonly today = signal(localToday());

  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly projects = signal<SavingsProject[]>([]);

  protected readonly editing = signal<Scheduled | null>(null);
  protected readonly kind = signal<ScheduledKind>('out');
  protected readonly accountId = signal('');
  protected readonly toAccountId = signal('');
  protected readonly projectId = signal('');
  protected readonly categoryId = signal('');
  protected readonly amountText = signal('');
  protected readonly description = signal('');
  protected readonly freq = signal<Freq>('monthly');
  protected readonly interval = signal(1);
  protected readonly day = signal(1);
  protected readonly weekdays = signal<ReadonlySet<number>>(new Set());
  protected readonly startDate = signal(localToday());
  protected readonly includeThisMonth = signal(false);
  protected readonly end = signal<'never' | 'until' | 'count'>('never');
  protected readonly until = signal('');
  protected readonly count = signal(12);
  protected readonly mode = signal<'auto' | 'confirm'>('auto');
  protected readonly remind = signal(false);
  protected readonly remindDays = signal(1);
  protected readonly notifyDone = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Cuentas que la persona edita (para apartar, sin tarjetas) */
  protected readonly accountOptions = computed(() =>
    this.accounts().filter(
      (a) =>
        a.permissions.canEdit &&
        !a.archivedAt &&
        (this.kind() !== 'set_aside' || a.kind !== 'credit'),
    ),
  );
  protected readonly toOptions = computed(() =>
    this.accountOptions().filter((a) => a.id !== this.accountId()),
  );
  protected readonly categoryOptions = computed(() => {
    const current = this.editing()?.category?.id;
    return this.categories().filter((c) => !c.disabled || c.id === current);
  });
  protected readonly projectOptions = computed(() => this.projects().filter((p) => !p.closedAt));
  /** Frecuencias comunes en finanzas (quincenal, trimestral, semestral…), más la actual si es otra */
  protected readonly frequencies = computed(() => {
    const common: [Freq, number][] = [
      ['monthly', 1],
      ['weekly', 1],
      ['weekly', 2],
      ['monthly', 2],
      ['monthly', 3],
      ['monthly', 6],
      ['yearly', 1],
      ['daily', 1],
    ];
    if (!common.some(([f, n]) => f === this.freq() && n === this.interval()))
      common.push([this.freq(), this.interval()]);
    return common.map(([freq, interval]) => ({
      value: `${freq}:${interval}`,
      label:
        interval > 1
          ? this.i18n.t(`lists.repeat.everyN.${freq}`, { n: interval })
          : this.i18n.t(`lists.repeat.freq.${freq}`),
    }));
  });

  protected setFrequency(value: string): void {
    const [freq, interval] = value.split(':') as [Freq, string];
    this.freq.set(freq);
    this.interval.set(Number(interval));
  }

  protected readonly weekdayList = computed(() => {
    const names = weekdayNames(this.i18n.locale());
    return WEEK_ORDER.map((d) => ({ day: d, name: names[d]! }));
  });
  protected readonly showThisMonth = computed(
    () => this.freq() === 'monthly' && !this.editing() && dayPassed(this.day(), this.today()),
  );

  /** Primera fecha: mensual por día del mes; las demás, la fecha de inicio */
  protected readonly start = computed(() => {
    if (this.freq() === 'monthly')
      return monthlyStart(
        this.day(),
        this.today(),
        this.includeThisMonth() && this.showThisMonth(),
      );
    if (this.freq() === 'weekly' && this.weekdays().size) {
      // El primer día elegido desde la fecha de inicio
      for (let i = 0; i < 7; i++) {
        const d = new Date(`${this.startDate()}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        if (this.weekdays().has(d.getUTCDay())) return d.toISOString().slice(0, 10);
      }
    }
    return this.startDate();
  });
  protected readonly amount = computed(() => parseAmount(this.amountText(), this.i18n.locale()));
  protected readonly canSave = computed(() => {
    const amount = this.amount();
    if (
      this.busy() ||
      !this.accountId() ||
      !this.description().trim() ||
      amount === null ||
      amount <= 0
    )
      return false;
    if ((this.kind() === 'in' || this.kind() === 'out') && !this.categoryId()) return false;
    if (this.kind() === 'transfer' && !this.toAccountId()) return false;
    if (this.kind() === 'set_aside' && !this.projectId()) return false;
    if (this.end() === 'until' && (!this.until() || this.until() < this.start())) return false;
    return true;
  });

  async open(item: Scheduled | null, prefill: ScheduledPrefill = {}): Promise<void> {
    this.error.set(null);
    this.today.set(localToday());
    this.editing.set(item);
    // Primero las opciones y los valores; después se muestra (así nada se borra mientras se escribe)
    await this.loadOptions();

    const rule = item?.rule;
    this.kind.set(item?.kind ?? 'out');
    this.accountId.set(item?.account.id ?? prefill.accountId ?? this.accountOptions()[0]?.id ?? '');
    this.toAccountId.set(item?.toAccount?.id ?? '');
    this.projectId.set(item?.project?.id ?? '');
    this.categoryId.set(item?.category?.id ?? prefill.categoryId ?? '');
    const amount = item?.amount ?? prefill.amount;
    this.amountText.set(amount ? amountForInput(amount, this.i18n.locale()) : '');
    this.description.set(item?.description ?? prefill.description ?? '');
    this.freq.set(rule?.freq ?? 'monthly');
    this.interval.set(rule?.interval ?? 1);
    this.day.set(
      rule ? Number(rule.start.slice(8)) : (prefill.day ?? Number(this.today().slice(8))),
    );
    this.weekdays.set(new Set(rule?.weekdays ?? []));
    this.startDate.set(item?.nextDate ?? rule?.start ?? this.today());
    this.includeThisMonth.set(false);
    this.end.set(rule?.until ? 'until' : rule?.count ? 'count' : 'never');
    this.until.set(rule?.until ?? '');
    this.count.set(rule?.count ?? 12);
    this.mode.set(item?.mode ?? 'auto');
    this.remind.set(!!item?.remindDays);
    this.remindDays.set(item?.remindDays ?? 1);
    this.notifyDone.set(item?.notifyDone ?? true);
    this.dialog().nativeElement.showModal();
  }

  private async loadOptions(): Promise<void> {
    const familyId = this.familyId();
    const [accounts, categories, savings] = await Promise.all([
      this.store.accounts(familyId).catch(() => null),
      this.store.categories(familyId).catch(() => null),
      this.savings.list(familyId).catch(() => null),
    ]);
    this.accounts.set(accounts?.accounts ?? []);
    this.categories.set(categories?.categories ?? []);
    this.projects.set(savings?.projects ?? []);
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected setKind(kind: ScheduledKind): void {
    this.kind.set(kind);
    // La cuenta elegida puede no servir para el nuevo tipo (ej. apartar en una tarjeta)
    if (!this.accountOptions().some((a) => a.id === this.accountId()))
      this.accountId.set(this.accountOptions()[0]?.id ?? '');
    if (kind === 'transfer' && !this.toAccountId())
      this.toAccountId.set(this.toOptions()[0]?.id ?? '');
    if (kind === 'set_aside' && !this.projectId())
      this.projectId.set(this.projectOptions()[0]?.id ?? '');
  }

  protected toggleDay(day: number): void {
    this.weekdays.update((s) => {
      const next = new Set(s);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  protected kindLabel(k: ScheduledKind): string {
    return this.i18n.t(`finance.scheduled.kinds.${k}`);
  }

  protected dateLabel(iso: string): string {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  protected int(value: string, min: number, max: number): number {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }

  protected async save(): Promise<void> {
    const amount = this.amount();
    if (!this.canSave() || amount === null) return;
    const kind = this.kind();
    const rule: ScheduledRule = {
      freq: this.freq(),
      interval: this.interval(),
      start: this.start(),
      ...(this.freq() === 'weekly' && this.weekdays().size
        ? { weekdays: [...this.weekdays()].sort() }
        : {}),
      until: this.end() === 'until' ? this.until() : null,
      count: this.end() === 'count' ? this.count() : null,
    };
    const body: ScheduledInput = {
      accountId: this.accountId(),
      kind,
      toAccountId: kind === 'transfer' ? this.toAccountId() : null,
      savingsProjectId: kind === 'set_aside' ? this.projectId() : null,
      categoryId: kind === 'in' || kind === 'out' ? this.categoryId() : null,
      amount,
      description: this.description().trim(),
      mode: this.mode(),
      rule,
      remindDays: this.remind() ? this.remindDays() : null,
      notifyDone: this.notifyDone(),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const current = this.editing();
      if (current) await this.scheduled.update(current.id, body);
      else await this.scheduled.create(this.familyId(), { id: crypto.randomUUID(), ...body });
      this.close();
      this.saved.emit();
    } catch (err) {
      const e = toApiError(err);
      this.error.set(
        this.i18n.error(e.code === 'VALIDATION' ? Object.values(e.fields)[0] : e.code),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
