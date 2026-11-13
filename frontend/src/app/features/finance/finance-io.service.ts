import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { I18n } from '../../core/i18n/i18n.service';
import { localToday } from './finance-logic';
import {
  buildCsv,
  buildWorkbook,
  exportFileName,
  parseCsv,
  parseWorkbook,
  ParsedFile,
  RawSheet,
} from './finance-io';
import { ExportData, ImportPayload, ImportReport, Summary } from './finance.models';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Error al leer un archivo, con el código que se traduce en pantalla */
export class ImportFileError extends Error {
  constructor(
    readonly code: 'IMPORT_FILE_TYPE' | 'IMPORT_FILE_TOO_LARGE' | 'IMPORT_FILE_UNREADABLE',
  ) {
    super(code);
  }
}

export interface ExportQuery {
  accounts?: string[];
  from?: string;
  to?: string;
}

/**
 * Importar y exportar finanzas (necesita conexión). Los archivos se leen y se arman en el navegador;
 * las librerías de Excel se cargan solo al usarlas.
 */
@Injectable({ providedIn: 'root' })
export class FinanceIoService {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);

  exportData(familyId: string, q: ExportQuery = {}): Promise<ExportData> {
    const params: Record<string, string> = {};
    if (q.accounts?.length) params['accounts'] = q.accounts.join(',');
    if (q.from) params['from'] = q.from;
    if (q.to) params['to'] = q.to;
    return firstValueFrom(
      this.http.get<ExportData>(`/api/families/${familyId}/export`, { params }),
    );
  }

  /**
   * Descarga Excel o CSV. Con `summary` el Excel lleva además la hoja Resumen;
   * con `template` sale sin movimientos (para llenar a mano).
   */
  async download(
    familyId: string,
    q: ExportQuery,
    format: 'xlsx' | 'csv',
    subject: string,
    opts: { summary?: Summary; template?: boolean } = {},
  ): Promise<void> {
    const data = await this.exportData(familyId, q);
    if (opts.template) data.movements = [];
    const locale = this.i18n.locale();
    const name = exportFileName(subject, localToday(), locale);
    if (format === 'csv') {
      saveBlob(
        new Blob([buildCsv(data, locale)], { type: 'text/csv;charset=utf-8' }),
        `${name}.csv`,
      );
      return;
    }
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const blob = await writeXlsxFile(buildWorkbook(data, locale, opts.summary)).toBlob();
    saveBlob(blob, `${name}.xlsx`);
  }

  /** Lee un .xlsx (todas sus hojas) o un .csv (solo movimientos) */
  async readFile(file: File): Promise<ParsedFile> {
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'xlsx' && extension !== 'csv') throw new ImportFileError('IMPORT_FILE_TYPE');
    if (file.size > MAX_FILE_BYTES) throw new ImportFileError('IMPORT_FILE_TOO_LARGE');
    let sheets: RawSheet[];
    try {
      if (extension === 'csv') sheets = [{ sheet: file.name, data: parseCsv(await file.text()) }];
      else {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        sheets = (await readXlsxFile(file)) as RawSheet[];
      }
    } catch {
      throw new ImportFileError('IMPORT_FILE_UNREADABLE');
    }
    return parseWorkbook(sheets, this.i18n.locale());
  }

  /** dryRun: vista previa sin guardar */
  run(familyId: string, payload: ImportPayload, dryRun: boolean): Promise<ImportReport> {
    return firstValueFrom(
      this.http.post<ImportReport>(`/api/families/${familyId}/import`, { ...payload, dryRun }),
    );
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
