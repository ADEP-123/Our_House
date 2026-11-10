import { Movement, MovementColumn } from './finance.models';

/** Columnas en el orden en que se muestran; la descripción no se puede ocultar */
export const MOVEMENT_COLUMNS: MovementColumn[] = [
  'code',
  'date',
  'description',
  'category',
  'amount',
  'balance',
  'createdBy',
];
export const HIDEABLE_COLUMNS = MOVEMENT_COLUMNS.filter((c) => c !== 'description');

/**
 * Monto escrito por la persona: "1234.5", "1234,5", "1.234,56", "1,234.56", "$ 20".
 * - Con punto y coma, el último es el decimal.
 * - Si un separador se repite ("1.234.567"), es de miles.
 * - Uno solo seguido de exactamente 3 cifras ("1.500" o "1,500") es ambiguo: decide el idioma
 *   (en español el punto es de miles; en inglés, la coma). Con 1, 2 o más de 3 cifras es decimal.
 * Devuelve null si no es un número.
 */
export function parseAmount(text: string, locale = 'es'): number | null {
  let s = text.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s
      .split(decimal === '.' ? ',' : '.')
      .join('')
      .replace(decimal, '.');
  } else if (dots + commas > 1) {
    s = s.split(dots ? '.' : ',').join('');
  } else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const thousandsSep = locale.startsWith('en') ? ',' : '.';
    const isThousands = sep === thousandsSep && /^-?\d{1,3}[.,]\d{3}$/.test(s);
    s = isThousands ? s.replace(sep, '') : s.replace(sep, '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Número para mostrar en un campo editable: sin miles y con la coma decimal en español ("1552,25") */
export function amountForInput(n: number, locale = 'es'): string {
  const text = String(Math.round(n * 100) / 100);
  return locale.startsWith('en') ? text : text.replace('.', ',');
}

export interface MovementFilters {
  text: string;
  categoryId: string;
  kind: 'all' | 'in' | 'out';
  from: string;
  to: string;
}

export const EMPTY_FILTERS: MovementFilters = {
  text: '',
  categoryId: '',
  kind: 'all',
  from: '',
  to: '',
};

export const hasFilters = (f: MovementFilters): boolean =>
  !!(f.text.trim() || f.categoryId || f.kind !== 'all' || f.from || f.to);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Movimientos que cumplen los filtros y sus totales.
 * Entradas: lo que sube el saldo (entradas, saldo inicial y ajustes positivos); salidas: lo que lo baja.
 */
export function filterMovements(list: Movement[], f: MovementFilters) {
  const text = fold(f.text.trim());
  const rows = list.filter((m) => {
    if (text && !fold(`${m.description} ${m.code} ${m.category?.name ?? ''}`).includes(text))
      return false;
    if (f.categoryId && m.category?.id !== f.categoryId) return false;
    if (f.kind === 'in' && m.signedAmount <= 0) return false;
    if (f.kind === 'out' && m.signedAmount >= 0) return false;
    if (f.from && m.date < f.from) return false;
    if (f.to && m.date > f.to) return false;
    return true;
  });
  let income = 0;
  let expense = 0;
  for (const m of rows) {
    if (m.signedAmount > 0) income += m.signedAmount;
    else expense -= m.signedAmount;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    rows,
    totals: {
      count: rows.length,
      income: r2(income),
      expense: r2(expense),
      net: r2(income - expense),
    },
  };
}
