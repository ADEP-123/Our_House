/** Cálculos de las deudas: saldo, cuotas, deuda de cada mes y resumen mensual de una tarjeta. */

export type DebtEntryKind = 'payment' | 'increase' | 'decrease';

export interface DebtEntryLike {
  kind: DebtEntryKind;
  amount: number;
  date: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Saldo = monto inicial + aumentos − disminuciones − abonos (sin bajar de 0) */
export function debtBalance(amount: number, entries: DebtEntryLike[], upTo?: string): number {
  const list = upTo ? entries.filter((e) => e.date <= upTo) : entries;
  const total = list.reduce((s, e) => (e.kind === 'increase' ? s + e.amount : s - e.amount), amount);
  return r2(Math.max(0, total));
}

export const paidOf = (entries: DebtEntryLike[]) => r2(entries.filter((e) => e.kind === 'payment').reduce((s, e) => s + e.amount, 0));

/** Valor de cada cuota y cuántas van pagadas con lo abonado */
export function installmentInfo(amount: number, installments: number | null, paid: number) {
  if (!installments) return null;
  const each = r2(amount / installments);
  return { each, paid: Math.min(installments, Math.floor((paid + 0.005) / each)), total: installments };
}

/** Los últimos `count` meses hasta el de hoy: 'AAAA-MM' y su último día (o hoy, si es el mes en curso) */
export function lastMonths(today: string, count = 12): { month: string; end: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: { month: string; end: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = year * 12 + (month - 1) - i;
    const y = Math.floor(m / 12);
    const mm = (m % 12) + 1;
    const key = `${y}-${String(mm).padStart(2, '0')}`;
    const last = `${key}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
    out.push({ month: key, end: last < today ? last : today });
  }
  return out;
}

export interface CardMovementLike {
  date: string;
  kind: string;
  amount: number;
}

const signed = (m: CardMovementLike) => (m.kind === 'out' || m.kind === 'transfer_out' ? -Math.abs(m.amount) : m.amount);

/** Deuda de una tarjeta al cierre de una fecha */
export function cardDebtAt(movements: CardMovementLike[], end: string): number {
  return r2(Math.max(0, -movements.filter((m) => m.date <= end).reduce((s, m) => s + signed(m), 0)));
}

/** Por mes: compras, pagos y la deuda al cierre */
export function cardMonths(movements: CardMovementLike[], months: { month: string; end: string }[]) {
  return months.map(({ month, end }) => {
    const inMonth = movements.filter((m) => m.date.startsWith(month));
    return {
      month,
      purchases: r2(inMonth.filter((m) => m.kind === 'out' || m.kind === 'transfer_out').reduce((s, m) => s + m.amount, 0)),
      payments: r2(inMonth.filter((m) => m.kind === 'in' || m.kind === 'transfer_in').reduce((s, m) => s + m.amount, 0)),
      debt: cardDebtAt(movements, end),
    };
  });
}
