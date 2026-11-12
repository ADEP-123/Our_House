import type { Row, Sheet, SheetData } from 'write-excel-file/browser';
import { isSingleEmoji } from '../lists/list-icons';
import { LIST_COLORS, LIST_ICONS } from '../lists/list-presets';
import {
  AccountKind,
  ExportData,
  ImportAccountRow,
  ImportCategoryRow,
  ImportMovementRow,
  ImportPayload,
  IoKind,
  Summary,
  SummaryFreq,
} from './finance.models';
import { parseAmount } from './movement-logic';
import { periodLabel } from './summary-logic';

/**
 * Formato v1 de finanzas (Excel o CSV): una hoja de movimientos, una de cuentas y una de categorías.
 * Se exporta en el idioma de la persona y se importa en cualquiera de los dos (hojas, columnas y tipos).
 */

type Locale = 'es' | 'en';
const lang = (locale: string): Locale => (locale.startsWith('en') ? 'en' : 'es');

/** Sin tildes, minúsculas, sin lo que va entre paréntesis: "Cupo (solo crédito)" → "cupo" */
export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// ---------- Textos del archivo ----------

export const SHEETS = {
  es: {
    instructions: 'Instrucciones',
    movements: 'Movimientos',
    accounts: 'Cuentas',
    categories: 'Categorías',
    summary: 'Resumen',
  },
  en: {
    instructions: 'Instructions',
    movements: 'Movements',
    accounts: 'Accounts',
    categories: 'Categories',
    summary: 'Summary',
  },
} as const;

const SHEET_ALIASES = {
  movements: ['movimientos', 'movements', 'transactions'],
  accounts: ['cuentas', 'accounts'],
  categories: ['categorias', 'categories'],
};

export const HEADERS = {
  es: {
    movements: [
      'ID',
      'Cuenta',
      'Fecha',
      'Descripción',
      'Categoría',
      'Tipo',
      'Monto',
      'Cuenta destino',
    ],
    accounts: [
      'Cuenta',
      'Prefijo',
      'Tipo de cuenta',
      'Descripción',
      'Cupo (solo crédito)',
      'Saldo actual (calculado, no se importa)',
    ],
    categories: ['Categoría', 'Ícono', 'Color', 'Activa'],
  },
  en: {
    movements: [
      'ID',
      'Account',
      'Date',
      'Description',
      'Category',
      'Type',
      'Amount',
      'Destination account',
    ],
    accounts: [
      'Account',
      'Prefix',
      'Account type',
      'Description',
      'Credit limit (credit only)',
      'Current balance (calculated, not imported)',
    ],
    categories: ['Category', 'Icon', 'Color', 'Active'],
  },
} as const;

const COLUMN_ALIASES = {
  movements: {
    code: ['id'],
    account: ['cuenta', 'account'],
    date: ['fecha', 'date'],
    description: ['descripcion', 'description'],
    category: ['categoria', 'category'],
    kind: ['tipo', 'type'],
    amount: ['monto', 'amount', 'valor', 'value'],
    destination: ['cuenta destino', 'destination account', 'destination', 'to account'],
  },
  accounts: {
    name: ['cuenta', 'account', 'nombre', 'name'],
    prefix: ['prefijo', 'prefix'],
    kind: ['tipo de cuenta', 'account type', 'tipo', 'type'],
    description: ['descripcion', 'description'],
    creditLimit: ['cupo', 'credit limit'],
  },
  categories: {
    name: ['categoria', 'category', 'nombre', 'name'],
    icon: ['icono', 'icon'],
    color: ['color'],
    active: ['activa', 'activo', 'active'],
  },
} as const;

/** Orden de las columnas de HEADERS, para nombrar en el idioma de la persona las que faltan */
const COLUMN_ORDER = {
  movements: [
    'code',
    'account',
    'date',
    'description',
    'category',
    'kind',
    'amount',
    'destination',
  ],
  accounts: ['name', 'prefix', 'kind', 'description', 'creditLimit'],
  categories: ['name', 'icon', 'color', 'active'],
} as const;

const REQUIRED = {
  movements: ['account', 'date', 'description', 'kind', 'amount'],
  accounts: ['name', 'kind'],
  categories: ['name'],
} as const;

export const KIND_LABELS: Record<Locale, Record<IoKind, string>> = {
  es: {
    in: 'Entrada',
    out: 'Salida',
    transfer: 'Transferencia',
    opening: 'Saldo inicial',
    adjust: 'Ajuste',
  },
  en: {
    in: 'Money in',
    out: 'Money out',
    transfer: 'Transfer',
    opening: 'Opening balance',
    adjust: 'Adjustment',
  },
};
const KIND_ALIASES: Record<string, IoKind> = {
  entrada: 'in',
  ingreso: 'in',
  'money in': 'in',
  income: 'in',
  in: 'in',
  salida: 'out',
  gasto: 'out',
  egreso: 'out',
  'money out': 'out',
  expense: 'out',
  out: 'out',
  transferencia: 'transfer',
  transfer: 'transfer',
  'saldo inicial': 'opening',
  'opening balance': 'opening',
  opening: 'opening',
  ajuste: 'adjust',
  'ajuste de saldo': 'adjust',
  adjustment: 'adjust',
  adjust: 'adjust',
};

export const ACCOUNT_KIND_LABELS: Record<Locale, Record<AccountKind, string>> = {
  es: { bank: 'Banco', cash: 'Efectivo', credit: 'Tarjeta de crédito', savings: 'Ahorro' },
  en: { bank: 'Bank', cash: 'Cash', credit: 'Credit card', savings: 'Savings' },
};
const ACCOUNT_KIND_ALIASES: Record<string, AccountKind> = {
  banco: 'bank',
  bank: 'bank',
  cuenta: 'bank',
  efectivo: 'cash',
  cash: 'cash',
  'tarjeta de credito': 'credit',
  tarjeta: 'credit',
  credito: 'credit',
  'credit card': 'credit',
  credit: 'credit',
  ahorro: 'savings',
  ahorros: 'savings',
  savings: 'savings',
};

export const COLOR_LABELS: Record<Locale, Record<string, string>> = {
  es: {
    blue: 'azul',
    green: 'verde',
    teal: 'turquesa',
    purple: 'morado',
    pink: 'rosado',
    red: 'rojo',
    orange: 'naranja',
    yellow: 'amarillo',
    gray: 'gris',
  },
  en: {
    blue: 'blue',
    green: 'green',
    teal: 'teal',
    purple: 'purple',
    pink: 'pink',
    red: 'red',
    orange: 'orange',
    yellow: 'yellow',
    gray: 'gray',
  },
};
const COLOR_ALIASES: Record<string, string> = {
  ...Object.fromEntries(Object.keys(LIST_COLORS).map((c) => [c, c])),
  ...Object.fromEntries(Object.entries(COLOR_LABELS.es).map(([id, label]) => [label, id])),
  rosa: 'pink',
  violeta: 'purple',
  'verde azulado': 'teal',
  grey: 'gray',
};

const YES = new Set(['si', 'yes', 'true', '1', 'x', 'activa', 'active']);
const NO = new Set(['no', 'false', '0', 'inactiva', 'inactive']);

// ---------- Leer ----------

export type Cell = string | number | boolean | Date | null | undefined;
export interface RawSheet {
  sheet: string;
  data: Cell[][];
}

/** Problema de una fila (o del archivo, con row 0) que no llega al servidor */
export interface ImportIssue {
  sheet: 'movements' | 'accounts' | 'categories' | 'file';
  row: number;
  code: string;
  params?: Record<string, string | number>;
}

export interface ParsedFile {
  payload: ImportPayload;
  issues: ImportIssue[];
  /** Hojas reconocidas */
  found: ('movements' | 'accounts' | 'categories')[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d &&
    y >= 1900 &&
    y <= 2200
    ? `${y}-${pad(m)}-${pad(d)}`
    : null;
};

/** Fecha de una celda: fecha de Excel, número de serie, "2026-11-05" o "5/11/2026" (en inglés, mes/día) */
export function parseDate(value: Cell, locale = 'es'): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Excel guarda fechas sin zona: se leen como medianoche UTC
    return isoOf(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number') {
    if (value < 1 || value > 150_000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return isoOf(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const [day, month] = lang(locale) === 'en' ? [+m[2]!, +m[1]!] : [+m[1]!, +m[2]!];
    return isoOf(year, month, day);
  }
  return null;
}

function parseNumber(value: Cell, locale: string): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const negative = /^\(.*\)$/.test(s) || /^[-−]/.test(s);
  const n = parseAmount(s.replace(/[−()]/g, ''), locale);
  return n === null ? null : negative ? -Math.abs(n) : n;
}

const text = (value: Cell) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim();

/** Índice de cada columna conocida según los encabezados */
function columnsOf<T extends Record<string, readonly string[]>>(
  header: Cell[],
  aliases: T,
): Partial<Record<keyof T, number>> {
  const result: Partial<Record<keyof T, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [key, names] of Object.entries(aliases) as [keyof T, readonly string[]][]) {
      if (result[key] === undefined && names.includes(n)) {
        result[key] = i;
        break;
      }
    }
  });
  return result;
}

const isEmpty = (row: Cell[]) =>
  row.every((c) => c === null || c === undefined || String(c).trim() === '');

export const validIcon = (value: string) => value in LIST_ICONS || isSingleEmoji(value);

/** Color de una celda: nombre (es/en) o hexadecimal, que se lleva al más parecido de la paleta */
export function parseColor(value: Cell): string | null {
  const s = norm(value);
  if (!s) return null;
  if (COLOR_ALIASES[s]) return COLOR_ALIASES[s]!;
  const hex = /^#?([0-9a-f]{6})$/.exec(s)?.[1];
  if (!hex) return null;
  const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = 'gray';
  let bestDistance = Infinity;
  for (const [id, color] of Object.entries(LIST_COLORS)) {
    const [r2, g2, b2] = rgb(color.slice(1));
    const distance = (r! - r2!) ** 2 + (g! - g2!) ** 2 + (b! - b2!) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [id, distance];
  }
  return best;
}

/**
 * Hojas leídas del archivo → filas listas para el servidor y problemas por fila.
 * Un CSV llega como una sola hoja de movimientos.
 */
export function parseWorkbook(sheets: RawSheet[], locale = 'es'): ParsedFile {
  const payload: ImportPayload = { accounts: [], categories: [], movements: [] };
  const issues: ImportIssue[] = [];
  const found: ParsedFile['found'] = [];
  const find = (kind: keyof typeof SHEET_ALIASES) =>
    sheets.find((s) => (SHEET_ALIASES[kind] as readonly string[]).includes(norm(s.sheet))) ??
    (kind === 'movements' && sheets.length === 1 ? sheets[0] : undefined);

  for (const kind of ['accounts', 'categories', 'movements'] as const) {
    const sheet = find(kind);
    if (!sheet) continue;
    const headerIndex = sheet.data.findIndex((r) => !isEmpty(r));
    if (headerIndex < 0) continue;
    const cols = columnsOf(sheet.data[headerIndex]!, COLUMN_ALIASES[kind]) as Record<
      string,
      number | undefined
    >;
    const missing = REQUIRED[kind].filter((c) => cols[c] === undefined);
    if (missing.length) {
      const labels = missing.map((c) =>
        HEADERS[lang(locale)][kind][(COLUMN_ORDER[kind] as readonly string[]).indexOf(c)]!.replace(
          / \(.*\)$/,
          '',
        ),
      );
      issues.push({
        sheet: 'file',
        row: 0,
        code: 'IMPORT_MISSING_COLUMNS',
        params: { sheet: sheet.sheet, columns: labels.join(', ') },
      });
      continue;
    }
    found.push(kind);
    const get = (r: Cell[], key: string) => (cols[key] === undefined ? null : r[cols[key]!]);

    sheet.data.slice(headerIndex + 1).forEach((r, i) => {
      if (isEmpty(r)) return;
      const row = headerIndex + i + 2; // número de fila como lo muestra Excel
      const fail = (code: string, params?: ImportIssue['params']): void => {
        issues.push({ sheet: kind, row, code, ...(params ? { params } : {}) });
      };

      if (kind === 'accounts') {
        const name = text(get(r, 'name'));
        const accountKind = ACCOUNT_KIND_ALIASES[norm(get(r, 'kind'))];
        if (!name) return fail('ACCOUNT_NAME_REQUIRED');
        if (name.length > 60) return fail('ACCOUNT_NAME_TOO_LONG');
        if (!accountKind)
          return fail('IMPORT_ACCOUNT_KIND_INVALID', { value: text(get(r, 'kind')) });
        const limit = parseNumber(get(r, 'creditLimit'), locale);
        payload.accounts.push({
          row,
          name,
          prefix: text(get(r, 'prefix')).toUpperCase() || null,
          kind: accountKind,
          description: text(get(r, 'description')).slice(0, 280) || null,
          creditLimit: limit === null ? null : Math.abs(limit),
        });
        return;
      }

      if (kind === 'categories') {
        const name = text(get(r, 'name'));
        if (!name) return fail('CATEGORY_NAME_REQUIRED');
        if (name.length > 40) return fail('CATEGORY_NAME_TOO_LONG');
        const icon = text(get(r, 'icon'));
        const active = norm(get(r, 'active'));
        payload.categories.push({
          row,
          name,
          icon: icon && validIcon(icon) ? icon : null,
          color: parseColor(get(r, 'color')),
          active:
            YES.has(active) || get(r, 'active') === true
              ? true
              : NO.has(active) || get(r, 'active') === false
                ? false
                : null,
        });
        return;
      }

      const account = text(get(r, 'account'));
      const description = text(get(r, 'description'));
      const movementKind = KIND_ALIASES[norm(get(r, 'kind'))];
      const date = parseDate(get(r, 'date') as Cell, locale);
      const amount = parseNumber(get(r, 'amount'), locale);
      if (!account) return fail('IMPORT_ACCOUNT_REQUIRED');
      if (!movementKind) return fail('IMPORT_KIND_INVALID', { value: text(get(r, 'kind')) });
      if (!date) return fail('IMPORT_DATE_INVALID', { value: text(get(r, 'date')) });
      if (amount === null) return fail('IMPORT_AMOUNT_INVALID', { value: text(get(r, 'amount')) });
      if (!description) return fail('MOVEMENT_DESCRIPTION_REQUIRED');
      if (description.length > 200) return fail('MOVEMENT_DESCRIPTION_TOO_LONG');
      payload.movements.push({
        row,
        code: text(get(r, 'code')).toUpperCase() || null,
        account,
        date,
        description,
        category: text(get(r, 'category')) || null,
        kind: movementKind,
        // Entradas, salidas y transferencias van en positivo aunque el archivo traiga signo
        amount: movementKind === 'opening' || movementKind === 'adjust' ? amount : Math.abs(amount),
        destination: text(get(r, 'destination')) || null,
      });
    });
  }
  if (!found.length && !issues.length)
    issues.push({ sheet: 'file', row: 0, code: 'IMPORT_NO_SHEETS' });
  return { payload, issues, found };
}

/** CSV con coma, punto y coma o tabulador (el que más aparezca en el encabezado); comillas dobles para textos */
export function parseCsv(content: string): Cell[][] {
  const textContent = content.replace(/^﻿/, '');
  const firstLine = textContent.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0]!;
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < textContent.length; i++) {
    const c = textContent[i]!;
    if (quoted) {
      if (c === '"' && textContent[i + 1] === '"') ((field += '"'), i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) (row.push(field), (field = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && textContent[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  return rows;
}

// ---------- Escribir ----------

const HEADER_STYLE = {
  fontWeight: 'bold',
  textColor: '#FFFFFF',
  backgroundColor: '#2F5D50',
} as const;
const header = (labels: readonly string[]): Row =>
  labels.map((value) => ({ value, ...HEADER_STYLE }));
const MONEY = '#,##0.00';

function instructions(l: Locale): SheetData {
  const lines =
    l === 'es'
      ? [
          'Our House · Finanzas · formato de importación/exportación v1',
          '',
          'Movimientos: una fila por movimiento. Columnas: ID, Cuenta, Fecha, Descripción, Categoría, Tipo, Monto, Cuenta destino.',
          'Tipo: Entrada, Salida, Transferencia, Saldo inicial o Ajuste.',
          '· Entrada y Salida: monto positivo y categoría obligatoria.',
          '· Saldo inicial y Ajuste: monto con signo (negativo si baja el saldo; en tarjetas la deuda va en negativo), sin categoría.',
          '· Transferencia: monto positivo y Cuenta destino. Se escribe una sola vez, desde la cuenta de origen.',
          'ID: si ya existe en la cuenta, se actualiza ese movimiento; si está libre (con el prefijo de la cuenta), se crea con ese número; vacío, se le asigna el siguiente.',
          'Lo que no está en el archivo no se borra.',
          '',
          'Cuentas: se crean las que no existen (tú quedas como dueño); las que ya existen no se cambian. El saldo actual es solo informativo.',
          'Tipo de cuenta: Banco, Efectivo, Tarjeta de crédito o Ahorro. Las tarjetas necesitan el cupo.',
          '',
          'Categorías: solo se aplican si importa un líder del grupo (crea las nuevas y cambia ícono, color o si está activa).',
          `Colores: ${Object.values(COLOR_LABELS.es).join(', ')}.`,
          '',
          'Antes de guardar, la app muestra qué se crea, qué se actualiza y qué filas tienen errores (esas se saltan).',
        ]
      : [
          'Our House · Finances · import/export format v1',
          '',
          'Movements: one row per movement. Columns: ID, Account, Date, Description, Category, Type, Amount, Destination account.',
          'Type: Money in, Money out, Transfer, Opening balance or Adjustment.',
          '· Money in and Money out: positive amount and a category.',
          '· Opening balance and Adjustment: signed amount (negative lowers the balance; card debt is negative), no category.',
          '· Transfer: positive amount and Destination account. Write it once, from the source account.',
          'ID: if it already exists in the account, that movement is updated; if it is free (with the account prefix), it is created with that number; empty, it gets the next one.',
          'Nothing that is missing from the file is deleted.',
          '',
          'Accounts: missing ones are created (you become the owner); existing ones are not changed. The current balance is for reference only.',
          'Account type: Bank, Cash, Credit card or Savings. Credit cards need the credit limit.',
          '',
          'Categories: only applied when a group leader imports (creates new ones and changes icon, color or active).',
          `Colors: ${Object.values(COLOR_LABELS.en).join(', ')}.`,
          '',
          'Before saving, the app shows what will be created, what will be updated and which rows have errors (those are skipped).',
        ];
  return lines.map((value, i) => [
    i === 0 ? { value, fontWeight: 'bold', fontSize: 14 } : value || null,
  ]);
}

const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Período de cada columna del resumen: "2–8 nov", "nov", "T1 2026" */
function summarySheet(summary: Summary, l: Locale): SheetData {
  const block = summary.combined;
  const multiYear = summary.from.slice(0, 4) !== summary.to.slice(0, 4);
  const labels = block.periods.map((p) =>
    periodLabel(p.start, p.end, summary.freq as SummaryFreq, l, multiYear),
  );
  const t =
    l === 'es'
      ? {
          title: 'Resumen',
          period: 'Período',
          accounts: 'Cuentas',
          category: 'Categoría',
          total: 'Total',
          expenses: 'Gastos',
          income: 'Ingresos',
          totalExpenses: 'Total gastos',
          totalIncome: 'Total ingresos',
          net: 'Balance',
          adjustments: 'Ajustes',
          closing: 'Saldo al cierre',
          none: 'Sin categoría',
        }
      : {
          title: 'Summary',
          period: 'Period',
          accounts: 'Accounts',
          category: 'Category',
          total: 'Total',
          expenses: 'Expenses',
          income: 'Income',
          totalExpenses: 'Total expenses',
          totalIncome: 'Total income',
          net: 'Net',
          adjustments: 'Adjustments',
          closing: 'Closing balance',
          none: 'No category',
        };
  const money = (value: number) => ({ value, type: Number, format: MONEY });
  const bold = (value: number) => ({ ...money(value), fontWeight: 'bold' as const });
  const cell = (i: number, id: string, kind: 'income' | 'expense') =>
    money(block.periods[i]?.categories[id]?.[kind] ?? 0);
  const data: SheetData = [
    [{ value: t.title, fontWeight: 'bold', fontSize: 14 }],
    [t.period, `${summary.from} → ${summary.to}`],
    [t.accounts, summary.accounts.map((a) => a.name).join(', ')],
    [],
    header([t.category, ...labels, t.total]),
  ];
  const section = (title: string) =>
    data.push([{ value: title, fontWeight: 'bold', fontStyle: 'italic' }]);
  const expenses = block.categories.filter((c) => c.expense > 0);
  const incomes = block.categories.filter((c) => c.income > 0).sort((a, b) => b.income - a.income);
  if (expenses.length) {
    section(t.expenses);
    for (const c of expenses)
      data.push([
        c.name ?? t.none,
        ...labels.map((_, i) => cell(i, c.id, 'expense')),
        bold(c.expense),
      ]);
    data.push([
      { value: t.totalExpenses, fontWeight: 'bold' },
      ...block.periods.map((p) => bold(p.expense)),
      bold(block.expense),
    ]);
  }
  if (incomes.length) {
    section(t.income);
    for (const c of incomes)
      data.push([
        c.name ?? t.none,
        ...labels.map((_, i) => cell(i, c.id, 'income')),
        bold(c.income),
      ]);
    data.push([
      { value: t.totalIncome, fontWeight: 'bold' },
      ...block.periods.map((p) => bold(p.income)),
      bold(block.income),
    ]);
  }
  data.push([
    { value: t.net, fontWeight: 'bold' },
    ...block.periods.map((p) => bold(p.net)),
    bold(block.net),
  ]);
  if (block.adjustments)
    data.push([
      t.adjustments,
      ...block.periods.map((p) => money(p.adjustments)),
      bold(block.adjustments),
    ]);
  data.push([t.closing, ...block.periods.map((p) => money(p.balance)), bold(block.closingBalance)]);
  return data;
}

/** Hojas del archivo Excel (formato v1); con resumen, una hoja más con la tabla categoría × período */
export function buildWorkbook(data: ExportData, locale = 'es', summary?: Summary): Sheet<Blob>[] {
  const l = lang(locale);
  const names = SHEETS[l];
  const movements: SheetData = [
    header(HEADERS[l].movements),
    ...data.movements.map((m) => [
      m.code,
      m.account ?? '—',
      { value: isoToDate(m.date), type: Date, format: 'yyyy-mm-dd' },
      m.description,
      m.category ?? null,
      KIND_LABELS[l][m.kind],
      { value: m.amount, type: Number, format: MONEY },
      m.destination ?? null,
    ]),
  ];
  const accounts: SheetData = [
    header(HEADERS[l].accounts),
    ...data.accounts.map((a) => [
      a.name,
      a.prefix,
      ACCOUNT_KIND_LABELS[l][a.kind],
      a.description ?? null,
      a.creditLimit === null ? null : { value: a.creditLimit, type: Number, format: MONEY },
      {
        value: a.balance,
        type: Number,
        format: MONEY,
        fontStyle: 'italic' as const,
        textColor: '#666666',
      },
    ]),
  ];
  const yes = l === 'es' ? 'Sí' : 'Yes';
  const no = 'No';
  const categories: SheetData = [
    header(HEADERS[l].categories),
    ...data.categories.map((c) => [
      c.name,
      c.icon in LIST_ICONS ? LIST_ICONS[c.icon]! : c.icon,
      COLOR_LABELS[l][c.color] ?? c.color,
      c.active ? yes : no,
    ]),
  ];
  const sheets: Sheet<Blob>[] = [];
  if (summary)
    sheets.push({
      sheet: names.summary,
      data: summarySheet(summary, l),
      columns: [
        { width: 26 },
        ...summary.combined.periods.map(() => ({ width: 13 })),
        { width: 14 },
      ],
    });
  sheets.push(
    {
      sheet: names.movements,
      data: movements,
      stickyRowsCount: 1,
      columns: [
        { width: 10 },
        { width: 18 },
        { width: 12 },
        { width: 40 },
        { width: 18 },
        { width: 16 },
        { width: 14 },
        { width: 18 },
      ],
    },
    {
      sheet: names.accounts,
      data: accounts,
      stickyRowsCount: 1,
      columns: [
        { width: 18 },
        { width: 9 },
        { width: 18 },
        { width: 40 },
        { width: 18 },
        { width: 22 },
      ],
    },
    {
      sheet: names.categories,
      data: categories,
      stickyRowsCount: 1,
      columns: [{ width: 22 }, { width: 8 }, { width: 12 }, { width: 8 }],
    },
    { sheet: names.instructions, data: instructions(l), columns: [{ width: 120 }] },
  );
  return sheets;
}

/** CSV de movimientos: en español con punto y coma y coma decimal (como lo abre Excel en español) */
export function buildCsv(data: ExportData, locale = 'es'): string {
  const l = lang(locale);
  const sep = l === 'es' ? ';' : ',';
  const quote = (v: string) => (/[";,\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const amount = (n: number) => (l === 'es' ? String(n).replace('.', ',') : String(n));
  const lines = [
    HEADERS[l].movements.join(sep),
    ...data.movements.map((m) =>
      [
        m.code,
        m.account ?? '—',
        m.date,
        m.description,
        m.category ?? '',
        KIND_LABELS[l][m.kind],
        amount(m.amount),
        m.destination ?? '',
      ]
        .map((v) => quote(String(v)))
        .join(sep),
    ),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** "Our House - Finanzas - Nu - 2026-11-11" */
export function exportFileName(subject: string, today: string, locale = 'es'): string {
  const clean = subject.replace(/[\\/:*?"<>|]/g, '').trim();
  return `Our House - ${lang(locale) === 'es' ? 'Finanzas' : 'Finances'} - ${clean} - ${today}`;
}
