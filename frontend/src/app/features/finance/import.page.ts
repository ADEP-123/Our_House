import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { FamiliesService } from '../families/families.service';
import { formatMoney } from '../lists/item-logic';
import { ACCOUNT_KIND_LABELS, COLOR_LABELS, KIND_LABELS, ParsedFile } from './finance-io';
import { FinanceIoService, ImportFileError } from './finance-io.service';
import { ImportReport, ImportStatus } from './finance.models';

type Sheet = 'accounts' | 'categories' | 'movements';
type Filter = ImportStatus | 'all';

interface ViewRow {
  key: string;
  sheet: Sheet;
  row: number;
  status: ImportStatus;
  ref: string;
  detail: string;
  amount: string;
  message: string;
}

const PAGE = 150;
const SHEET_ORDER: Sheet[] = ['accounts', 'categories', 'movements'];

/**
 * Importar finanzas desde un Excel (formato v1) o un CSV de movimientos.
 * Se lee el archivo en el navegador, el servidor arma la vista previa y, al confirmar, guarda todo de una vez.
 * /finanzas/importar
 */
@Component({
  selector: 'oh-finance-import-page',
  imports: [RouterLink, TPipe],
  templateUrl: './import.page.html',
  styleUrl: './import.page.scss',
})
export class ImportPage implements OnInit {
  protected readonly families = inject(FamiliesService);
  private readonly io = inject(FinanceIoService);
  private readonly i18n = inject(I18n);
  protected readonly sync = inject(SyncStatus);

  protected readonly family = this.families.active;
  protected readonly fileName = signal<string | null>(null);
  protected readonly parsed = signal<ParsedFile | null>(null);
  protected readonly preview = signal<ImportReport | null>(null);
  protected readonly result = signal<ImportReport | null>(null);
  protected readonly busy = signal<'reading' | 'checking' | 'importing' | 'template' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<Filter>('all');
  protected readonly limit = signal(PAGE);
  protected readonly dragging = signal(false);

  /** Problemas de todo el archivo (hojas o columnas que faltan) */
  protected readonly fileIssues = computed(() =>
    (this.parsed()?.issues ?? [])
      .filter((i) => i.sheet === 'file')
      .map((i) => this.i18n.error(i.code, i.params)),
  );

  /** Filas del archivo con lo que pasará con cada una (errores de lectura incluidos) */
  protected readonly rows = computed<ViewRow[]>(() => {
    const parsed = this.parsed();
    const report = this.result() ?? this.preview();
    if (!parsed || !report) return [];
    const l = this.i18n.locale();
    const rows: ViewRow[] = [];
    for (const issue of parsed.issues) {
      if (issue.sheet === 'file') continue;
      rows.push({
        key: `${issue.sheet}:${issue.row}`,
        sheet: issue.sheet,
        row: issue.row,
        status: 'error',
        ref: '',
        detail: '',
        amount: '',
        message: this.i18n.error(issue.code, issue.params),
      });
    }
    for (const r of report.accounts) {
      const a = parsed.payload.accounts.find((x) => x.row === r.row)!;
      rows.push(this.view('accounts', r, `${a.name} · ${ACCOUNT_KIND_LABELS[l][a.kind]}`, ''));
    }
    for (const r of report.categories) {
      const c = parsed.payload.categories.find((x) => x.row === r.row)!;
      rows.push(this.view('categories', r, `${c.icon ?? ''} ${c.name}`.trim(), ''));
    }
    for (const r of report.movements) {
      const m = parsed.payload.movements.find((x) => x.row === r.row)!;
      const where = m.kind === 'transfer' ? `${m.account} → ${m.destination ?? '?'}` : m.account;
      const detail = [
        this.dateLabel(m.date),
        where,
        KIND_LABELS[l][m.kind],
        m.category,
        m.description,
      ]
        .filter(Boolean)
        .join(' · ');
      rows.push(this.view('movements', r, detail, this.money(m.amount)));
    }
    return rows.sort(
      (a, b) => SHEET_ORDER.indexOf(a.sheet) - SHEET_ORDER.indexOf(b.sheet) || a.row - b.row,
    );
  });

  protected readonly counts = computed(() => {
    const counts: Record<Filter, number> = {
      all: 0,
      create: 0,
      update: 0,
      unchanged: 0,
      skipped: 0,
      error: 0,
    };
    for (const r of this.rows()) (counts[r.status]++, counts.all++);
    return counts;
  });

  protected readonly visibleRows = computed(() => {
    const f = this.filter();
    return this.rows().filter((r) => f === 'all' || r.status === f);
  });

  /** Lo que se guardará al confirmar */
  protected readonly changes = computed(() => this.counts().create + this.counts().update);

  protected readonly sections = computed(() => {
    const report = this.result() ?? this.preview();
    if (!report) return [];
    const parsed = this.parsed();
    const readErrors = (sheet: Sheet) =>
      parsed?.issues.filter((i) => i.sheet === sheet).length ?? 0;
    return SHEET_ORDER.filter((s) => report[s].length || readErrors(s)).map((s) => ({
      sheet: s,
      counts: { ...report.counts[s], error: report.counts[s].error + readErrors(s) },
    }));
  });

  protected readonly filters: Filter[] = [
    'all',
    'error',
    'create',
    'update',
    'unchanged',
    'skipped',
  ];

  async ngOnInit(): Promise<void> {
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
  }

  // ---------- Archivo ----------

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // así se puede elegir el mismo archivo otra vez
    if (file) void this.load(file);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) void this.load(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  private async load(file: File): Promise<void> {
    const family = this.family();
    if (!family) return;
    this.reset();
    this.fileName.set(file.name);
    this.busy.set('reading');
    try {
      const parsed = await this.io.readFile(file);
      this.parsed.set(parsed);
      const { accounts, categories, movements } = parsed.payload;
      if (!accounts.length && !categories.length && !movements.length) return;
      this.busy.set('checking');
      const report = await this.io.run(family.id, parsed.payload, true);
      this.preview.set(report);
      this.filter.set(this.counts().error ? 'error' : 'all');
    } catch (err) {
      this.error.set(
        this.i18n.error(err instanceof ImportFileError ? err.code : toApiError(err).code),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected reset(): void {
    this.fileName.set(null);
    this.parsed.set(null);
    this.preview.set(null);
    this.result.set(null);
    this.error.set(null);
    this.filter.set('all');
    this.limit.set(PAGE);
  }

  protected async confirmImport(): Promise<void> {
    const family = this.family();
    const parsed = this.parsed();
    if (!family || !parsed || !this.changes()) return;
    this.busy.set('importing');
    this.error.set(null);
    try {
      this.result.set(await this.io.run(family.id, parsed.payload, false));
      this.filter.set('all');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(null);
    }
  }

  protected async downloadTemplate(): Promise<void> {
    const family = this.family();
    if (!family) return;
    this.busy.set('template');
    try {
      await this.io.download(family.id, {}, 'xlsx', this.i18n.t('finance.io.templateSubject'), {
        template: true,
      });
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(null);
    }
  }

  // ---------- Textos ----------

  protected busyText(): string {
    return this.i18n.t(this.busy() === 'reading' ? 'finance.io.reading' : 'finance.io.checking');
  }

  protected setFilter(f: Filter): void {
    this.filter.set(f);
    this.limit.set(PAGE);
  }

  protected statusLabel(s: Filter): string {
    return this.i18n.t(`finance.io.status.${s}`);
  }

  protected sheetLabel(s: Sheet): string {
    return this.i18n.t(`finance.io.sheets.${s}`);
  }

  protected doneText(): string {
    const r = this.result();
    if (!r) return '';
    return this.i18n.t('finance.io.doneText', {
      created: r.counts.movements.create,
      updated: r.counts.movements.update,
      accounts: r.counts.accounts.create,
      categories: r.counts.categories.create + r.counts.categories.update,
    });
  }

  private view(
    sheet: Sheet,
    r: ImportReport['movements'][number],
    detail: string,
    amount: string,
  ): ViewRow {
    let message = '';
    if (r.code) message = this.i18n.error(r.code, r.params);
    else if (r.changes)
      message = Object.entries(r.changes)
        .map(([field, [from, to]]) => this.change(field, from, to))
        .join(' · ');
    return {
      key: `${sheet}:${r.row}`,
      sheet,
      row: r.row,
      status: r.status,
      ref: r.ref ?? '',
      detail,
      amount,
      message,
    };
  }

  private change(field: string, from: unknown, to: unknown): string {
    const l = this.i18n.locale().startsWith('en') ? 'en' : 'es';
    const show = (v: unknown) => {
      if (v === null || v === undefined || v === '') return '—';
      if (field === 'amount') return this.money(Number(v));
      if (field === 'date') return this.dateLabel(String(v));
      if (field === 'kind')
        return KIND_LABELS[l][String(v) as keyof (typeof KIND_LABELS)['es']] ?? String(v);
      if (field === 'color') return COLOR_LABELS[l][String(v)] ?? String(v);
      if (field === 'active') return this.i18n.t(v ? 'finance.io.yes' : 'finance.io.no');
      return String(v);
    };
    const label = [
      'amount',
      'date',
      'description',
      'category',
      'kind',
      'icon',
      'color',
      'active',
    ].includes(field)
      ? this.i18n.t(`finance.io.fields.${field as 'amount'}`)
      : field;
    return `${label}: ${show(from)} → ${show(to)}`;
  }

  private money(n: number): string {
    return formatMoney(n, (this.result() ?? this.preview())?.currency ?? 'USD', this.i18n.locale());
  }

  private dateLabel(iso: string): string {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}
