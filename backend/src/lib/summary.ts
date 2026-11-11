/**
 * Cálculo del resumen de finanzas (sin base de datos: se prueba con datos de ejemplo).
 * - Entradas y salidas: solo movimientos 'in' y 'out'. El saldo inicial no es ingreso.
 * - Transferencias: no cuentan como gasto ni ingreso (se informan aparte).
 * - Ajustes de saldo: van aparte, en "ajustes", sin sumar a gastos ni ingresos.
 * - Saldos: todo movimiento cuenta (incluidos saldo inicial, ajustes y transferencias).
 */

export const SUMMARY_FREQS = ['week', 'month', 'quarter', 'year'] as const;
export type SummaryFreq = (typeof SUMMARY_FREQS)[number];
/** Más columnas que esto no se leen en una tabla: hay que elegir una frecuencia mayor */
export const MAX_PERIODS = 120;

export interface SummaryMovement {
  account_id: string;
  kind: 'opening' | 'in' | 'out' | 'adjust' | 'transfer_in' | 'transfer_out';
  amount: number;
  date: string;
  category_id: string | null;
}

export interface SummaryAccount {
  id: string;
  name: string;
  kind: 'bank' | 'cash' | 'credit' | 'savings';
  credit_limit: number | null;
}

export interface SummaryCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Fechas (AAAA-MM-DD, sin zona horaria) ----------

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Inicio del período que contiene la fecha (semana desde el lunes) */
function periodStart(iso: string, freq: SummaryFreq): string {
  const d = toDate(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (freq === 'week') return addDays(iso, -((d.getUTCDay() + 6) % 7));
  if (freq === 'month') return toIso(new Date(Date.UTC(y, m, 1)));
  if (freq === 'quarter') return toIso(new Date(Date.UTC(y, m - (m % 3), 1)));
  return `${y}-01-01`;
}

function nextPeriodStart(start: string, freq: SummaryFreq): string {
  const d = toDate(start);
  if (freq === 'week') return addDays(start, 7);
  const months = freq === 'month' ? 1 : freq === 'quarter' ? 3 : 12;
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

/** Períodos que cubren [from, to], recortados a ese rango */
export function buildPeriods(from: string, to: string, freq: SummaryFreq): { start: string; end: string }[] {
  const periods: { start: string; end: string }[] = [];
  let start = periodStart(from, freq);
  while (start <= to) {
    const next = nextPeriodStart(start, freq);
    periods.push({ start: start < from ? from : start, end: addDays(next, -1) > to ? to : addDays(next, -1) });
    start = next;
  }
  return periods;
}

/**
 * Período anterior para comparar: el mes anterior si es un mes completo,
 * el año anterior si es un año completo; si no, la misma cantidad de días justo antes.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = toDate(from);
  const t = toDate(to);
  const sameMonth = f.getUTCFullYear() === t.getUTCFullYear() && f.getUTCMonth() === t.getUTCMonth();
  if (sameMonth && f.getUTCDate() === 1 && t.getUTCDate() === lastDayOfMonth(t.getUTCFullYear(), t.getUTCMonth())) {
    const y = f.getUTCFullYear();
    const m = f.getUTCMonth() - 1;
    const start = new Date(Date.UTC(y, m, 1));
    return { from: toIso(start), to: toIso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth())))) };
  }
  if (from.endsWith('-01-01') && to.endsWith('-12-31') && from.slice(0, 4) === to.slice(0, 4)) {
    const y = Number(from.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

// ---------- Totales ----------

const signed = (m: SummaryMovement) => (m.kind === 'out' || m.kind === 'transfer_out' ? -m.amount : m.amount);

interface Flow {
  income: number;
  expense: number;
  adjustments: number;
  transfersIn: number;
  transfersOut: number;
}
const emptyFlow = (): Flow => ({ income: 0, expense: 0, adjustments: 0, transfersIn: 0, transfersOut: 0 });

function addFlow(flow: Flow, m: SummaryMovement): void {
  if (m.kind === 'in') flow.income += m.amount;
  else if (m.kind === 'out') flow.expense += m.amount;
  else if (m.kind === 'adjust') flow.adjustments += m.amount;
  else if (m.kind === 'transfer_in') flow.transfersIn += m.amount;
  else if (m.kind === 'transfer_out') flow.transfersOut += m.amount;
}

const roundFlow = (f: Flow) => ({
  income: r2(f.income),
  expense: r2(f.expense),
  net: r2(f.income - f.expense),
  adjustments: r2(f.adjustments),
  transfersIn: r2(f.transfersIn),
  transfersOut: r2(f.transfersOut),
});

/** Bloque del resumen para un conjunto de cuentas (todas juntas o una sola) */
function block(
  movements: SummaryMovement[],
  periods: { start: string; end: string }[],
  range: { from: string; to: string },
  previous: { from: string; to: string },
  categories: Map<string, SummaryCategory>,
) {
  const inRange = (m: SummaryMovement, r: { from: string; to: string }) => m.date >= r.from && m.date <= r.to;
  const total = emptyFlow();
  const prev = emptyFlow();
  const byCategory = new Map<string, { income: number; expense: number }>();
  const byPeriod = periods.map(() => ({ flow: emptyFlow(), categories: new Map<string, { income: number; expense: number }>() }));
  let opening = 0;

  for (const m of movements) {
    if (m.date < range.from) opening += signed(m);
    if (inRange(m, previous)) addFlow(prev, m);
    if (!inRange(m, range)) continue;
    addFlow(total, m);
    const i = periods.findIndex((p) => m.date >= p.start && m.date <= p.end);
    addFlow(byPeriod[i]!.flow, m);
    if ((m.kind === 'in' || m.kind === 'out') && m.category_id) {
      for (const map of [byCategory, byPeriod[i]!.categories]) {
        const c = map.get(m.category_id) ?? { income: 0, expense: 0 };
        if (m.kind === 'in') c.income += m.amount;
        else c.expense += m.amount;
        map.set(m.category_id, c);
      }
    }
  }

  let running = opening;
  return {
    ...roundFlow(total),
    previous: roundFlow(prev),
    openingBalance: r2(opening),
    closingBalance: r2(movements.filter((m) => m.date <= range.to).reduce((s, m) => s + signed(m), 0)),
    categories: [...byCategory.entries()]
      .map(([id, v]) => {
        const c = categories.get(id);
        return { id, name: c?.name ?? null, icon: c?.icon ?? null, color: c?.color ?? null, income: r2(v.income), expense: r2(v.expense) };
      })
      .sort((a, b) => b.expense - a.expense || b.income - a.income),
    periods: periods.map((p, i) => {
      const { flow, categories: cats } = byPeriod[i]!;
      running += movements.filter((m) => m.date >= p.start && m.date <= p.end).reduce((s, m) => s + signed(m), 0);
      return {
        ...p,
        ...roundFlow(flow),
        balance: r2(running),
        categories: Object.fromEntries([...cats.entries()].map(([id, v]) => [id, { income: r2(v.income), expense: r2(v.expense) }])),
      };
    }),
  };
}

/**
 * Saldos al final del período:
 * - deuda: lo que se debe en las tarjetas;
 * - real: lo que hay en las cuentas que no son tarjeta (sin restar la deuda);
 * - completo: real + lo que queda disponible en las tarjetas.
 */
function balances(accounts: SummaryAccount[], movements: SummaryMovement[], to: string) {
  let debt = 0;
  let real = 0;
  let available = 0;
  for (const a of accounts) {
    const balance = movements.filter((m) => m.account_id === a.id && m.date <= to).reduce((s, m) => s + signed(m), 0);
    if (a.kind === 'credit') {
      const owed = Math.max(0, -balance);
      debt += owed;
      available += (a.credit_limit ?? 0) - owed;
    } else {
      real += balance;
    }
  }
  return { debt: r2(debt), real: r2(real), complete: r2(real + available) };
}

export function buildSummary(input: {
  from: string;
  to: string;
  freq: SummaryFreq;
  accounts: SummaryAccount[];
  categories: SummaryCategory[];
  /** Movimientos vigentes de las cuentas incluidas hasta `to` */
  movements: SummaryMovement[];
}) {
  const periods = buildPeriods(input.from, input.to, input.freq);
  const previous = previousRange(input.from, input.to);
  const range = { from: input.from, to: input.to };
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  return {
    from: input.from,
    to: input.to,
    freq: input.freq,
    previous,
    accounts: input.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    balances: balances(input.accounts, input.movements, input.to),
    combined: block(input.movements, periods, range, previous, cats),
    byAccount: input.accounts.map((a) => ({
      accountId: a.id,
      ...block(
        input.movements.filter((m) => m.account_id === a.id),
        periods,
        range,
        previous,
        cats,
      ),
    })),
  };
}
