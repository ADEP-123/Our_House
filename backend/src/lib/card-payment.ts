/**
 * Pago de una tarjeta de crédito: fecha de pago de cada mes, corte y lo que falta por pagar.
 * La misma lógica está en el frontend (features/finance/card-logic.ts) para mostrarlo en la hoja.
 *
 * - Fecha de pago: el día de pago de cada mes (si el mes es más corto, su último día).
 * - Con día de corte: lo que se debe pagar es la deuda al cierre del día de corte anterior a la
 *   fecha de pago, menos los pagos registrados después del corte (nunca más que la deuda actual).
 *   Mientras el corte no llega, todavía no hay nada por pagar.
 * - Sin día de corte: se debe toda la deuda actual.
 */

export interface CardDays {
  paymentDay: number;
  cutDay: number | null;
}

export interface CardMovement {
  date: string;
  kind: string;
  amount: number;
}

export interface CardCycle {
  /** Fecha de pago (AAAA-MM-DD) */
  due: string;
  /** Día de corte de este pago; null si la tarjeta no tiene corte */
  cut: string | null;
  /** El corte ya pasó (o no hay corte): se sabe cuánto pagar */
  closed: boolean;
  /** Deuda al corte (null sin corte) */
  statement: number | null;
  /** Pagos registrados después del corte */
  paid: number;
  /** Lo que falta por pagar para esta fecha */
  pending: number;
  /** Deuda de hoy */
  debt: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

/** Día `day` del mes (1-12), o el último día si el mes es más corto */
export function dayOfMonth(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

const shiftMonth = (year: number, month: number, delta: number) => {
  const m = year * 12 + (month - 1) + delta;
  return { year: Math.floor(m / 12), month: (m % 12) + 1 };
};

const parts = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

/** Próxima fecha de pago desde hoy (hoy incluido) */
export function nextDue(paymentDay: number, today: string): string {
  const { year, month } = parts(today);
  const thisMonth = dayOfMonth(year, month, paymentDay);
  if (thisMonth >= today) return thisMonth;
  const next = shiftMonth(year, month, 1);
  return dayOfMonth(next.year, next.month, paymentDay);
}

/** Fecha de pago del mes anterior a `due` */
export function previousDue(paymentDay: number, due: string): string {
  const { year, month } = parts(due);
  const prev = shiftMonth(year, month, -1);
  return dayOfMonth(prev.year, prev.month, paymentDay);
}

/** Último día de corte antes de la fecha de pago */
export function cutBefore(due: string, cutDay: number): string {
  const { year, month } = parts(due);
  const sameMonth = dayOfMonth(year, month, cutDay);
  if (sameMonth < due) return sameMonth;
  const prev = shiftMonth(year, month, -1);
  return dayOfMonth(prev.year, prev.month, cutDay);
}

/** Salidas en negativo; lo demás (saldo inicial, entradas, ajustes) con su signo */
const signed = (m: CardMovement) => (m.kind === 'out' || m.kind === 'transfer_out' ? -Math.abs(m.amount) : m.amount);

/** Estado del pago de la tarjeta para la fecha `due`, visto desde `today` */
export function cardCycle(card: CardDays, due: string, movements: CardMovement[], today: string): CardCycle {
  const debt = r2(Math.max(0, -movements.reduce((s, m) => s + signed(m), 0)));
  if (card.cutDay === null) return { due, cut: null, closed: true, statement: null, paid: 0, pending: debt, debt };
  const cut = cutBefore(due, card.cutDay);
  const closed = cut < today;
  const statement = r2(Math.max(0, -movements.filter((m) => m.date <= cut).reduce((s, m) => s + signed(m), 0)));
  const paid = r2(movements.filter((m) => m.date > cut && (m.kind === 'in' || m.kind === 'transfer_in')).reduce((s, m) => s + m.amount, 0));
  const pending = closed ? r2(Math.max(0, Math.min(debt, statement - paid))) : 0;
  return { due, cut, closed, statement, paid, pending, debt };
}
