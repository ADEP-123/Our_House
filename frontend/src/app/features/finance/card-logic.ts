/**
 * Pago de una tarjeta de crédito: la misma regla que el backend (src/lib/card-payment.ts), para
 * mostrar en la hoja de la tarjeta cuándo toca pagar y cuánto falta, también sin conexión.
 *
 * - Fecha de pago: el día de pago de cada mes (si el mes es más corto, su último día).
 * - Con día de corte: deuda al cierre del corte anterior a la fecha de pago, menos los pagos
 *   registrados después del corte (nunca más que la deuda de hoy). Antes del corte, nada.
 * - Sin día de corte: toda la deuda de hoy.
 */

export interface CardMovement {
  date: string;
  kind: string;
  /** Con signo: las salidas en negativo */
  signedAmount: number;
}

export interface CardCycle {
  due: string;
  cut: string | null;
  closed: boolean;
  statement: number | null;
  paid: number;
  pending: number;
  debt: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

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

/** Último día de corte antes de la fecha de pago */
export function cutBefore(due: string, cutDay: number): string {
  const { year, month } = parts(due);
  const sameMonth = dayOfMonth(year, month, cutDay);
  if (sameMonth < due) return sameMonth;
  const prev = shiftMonth(year, month, -1);
  return dayOfMonth(prev.year, prev.month, cutDay);
}

export function cardCycle(
  card: { paymentDay: number; cutDay: number | null },
  due: string,
  movements: CardMovement[],
  today: string,
): CardCycle {
  const debt = r2(Math.max(0, -movements.reduce((s, m) => s + m.signedAmount, 0)));
  if (card.cutDay === null) return { due, cut: null, closed: true, statement: null, paid: 0, pending: debt, debt };
  const cut = cutBefore(due, card.cutDay);
  const closed = cut < today;
  const statement = r2(Math.max(0, -movements.filter((m) => m.date <= cut).reduce((s, m) => s + m.signedAmount, 0)));
  const paid = r2(
    movements
      .filter((m) => m.date > cut && (m.kind === 'in' || m.kind === 'transfer_in'))
      .reduce((s, m) => s + m.signedAmount, 0),
  );
  const pending = closed ? r2(Math.max(0, Math.min(debt, statement - paid))) : 0;
  return { due, cut, closed, statement, paid, pending, debt };
}

/** Lo que muestra la hoja: la próxima fecha de pago, los días que faltan y el estado del pago */
export interface CardPayment {
  paymentDay: number;
  daysLeft: number;
  cycle: CardCycle;
}

export function cardPayment(
  credit: { paymentDay: number | null; cutDay: number | null },
  movements: CardMovement[],
  today: string,
): CardPayment | null {
  if (!credit.paymentDay) return null;
  const due = nextDue(credit.paymentDay, today);
  const daysLeft = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return {
    paymentDay: credit.paymentDay,
    daysLeft,
    cycle: cardCycle({ paymentDay: credit.paymentDay, cutDay: credit.cutDay }, due, movements, today),
  };
}
