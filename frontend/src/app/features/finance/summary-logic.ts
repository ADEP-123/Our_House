import { SummaryConfig, SummaryFreq } from './finance.models';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Configuración inicial: el mes actual por semanas, todas las cuentas, todo junto */
export function defaultConfig(today = new Date()): SummaryConfig {
  return {
    mode: 'month',
    month: `${today.getFullYear()}-${pad(today.getMonth() + 1)}`,
    year: today.getFullYear(),
    freq: 'week',
    accounts: [],
    view: 'combined',
  };
}

/** Fechas del período elegido */
export function rangeOf(c: SummaryConfig, today = new Date()): { from: string; to: string } {
  if (c.mode === 'year') {
    const y = c.year ?? today.getFullYear();
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (c.mode === 'range' && c.from && c.to)
    return c.from <= c.to ? { from: c.from, to: c.to } : { from: c.to, to: c.from };
  const [y, m] = (c.month ?? `${today.getFullYear()}-${pad(today.getMonth() + 1)}`)
    .split('-')
    .map(Number) as [number, number];
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/** Frecuencia que se lee bien para la duración del período */
export function suggestedFreq(from: string, to: string): SummaryFreq {
  const days = dayDiff(from, to);
  if (days <= 62) return 'week';
  if (days <= 3 * 366) return 'month';
  if (days <= 10 * 366) return 'quarter';
  return 'year';
}

/** Cantidad aproximada de columnas (el servidor no acepta más de 120) */
export function periodCount(from: string, to: string, freq: SummaryFreq): number {
  const days = dayDiff(from, to);
  const per = { week: 7, month: 30.4, quarter: 91.3, year: 365.25 }[freq];
  return Math.ceil(days / per) + 1;
}

/** Nombre corto de cada columna: "2–8 nov", "nov", "T1 2026", "2026" */
export function periodLabel(
  start: string,
  end: string,
  freq: SummaryFreq,
  locale: string,
  multiYear: boolean,
): string {
  const d = (iso: string) => new Date(`${iso}T12:00:00`);
  const month = (iso: string) =>
    d(iso).toLocaleDateString(locale, { month: 'short' }).replace('.', '');
  if (freq === 'year') return start.slice(0, 4);
  if (freq === 'quarter')
    return `${locale.startsWith('en') ? 'Q' : 'T'}${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1} ${start.slice(0, 4)}`;
  if (freq === 'month') return multiYear ? `${month(start)} ${start.slice(2, 4)}` : month(start);
  const a = Number(start.slice(8));
  const b = Number(end.slice(8));
  if (start === end) return `${a} ${month(end)}`;
  return start.slice(5, 7) === end.slice(5, 7)
    ? `${a}–${b} ${month(end)}`
    : `${a} ${month(start)}–${b} ${month(end)}`;
}

/** Cambio porcentual frente al período anterior (null si antes era 0) */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/** Tope "redondo" del eje: 1, 2, 2.5, 5 o 10 por potencia de 10 */
/** Marcas del eje de 0 a top con un paso redondo: 2,5 y 5 se parten en quintos, el resto en cuartos */
export function niceTicks(top: number): number[] {
  const n = top / 10 ** Math.floor(Math.log10(top));
  const parts = n === 2.5 || n === 5 ? 5 : 4;
  return Array.from({ length: parts + 1 }, (_, i) => (top * i) / parts);
}

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(value));
  const n = value / p;
  // Topes que dejan cuartos redondos (1, 2, 2,5, 4, 5, 6, 8, 10) y poco espacio vacío arriba
  const steps = [1, 2, 2.5, 4, 5, 6, 8, 10];
  return steps.find((s) => n <= s)! * p;
}
