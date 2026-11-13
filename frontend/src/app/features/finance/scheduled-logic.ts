import { ScheduledKind, UpcomingItem } from './finance.models';

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Día `day` del mes (si no existe, el último: 31 → 30 o 28) */
const onDay = (y: number, m: number, day: number) => {
  const year = y + Math.floor((m - 1) / 12);
  const month = ((m - 1) % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(day, daysIn(year, month)))}`;
};

/**
 * Primera fecha de un programado mensual que se cobra el día `day`.
 * Si ese día de este mes ya pasó, empieza el mes siguiente, salvo que se pida registrar también el de este mes.
 */
export function monthlyStart(day: number, today: string, includeThisMonth = false): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const thisMonth = onDay(y, m, day);
  return thisMonth >= today || includeThisMonth ? thisMonth : onDay(y, m + 1, day);
}

/** ¿El día de este mes ya pasó? (para ofrecer "registrar también el de este mes") */
export function dayPassed(day: number, today: string): boolean {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return onDay(y, m, day) < today;
}

/** Efecto en el saldo de las cuentas elegidas: una transferencia entre dos de ellas no cambia nada y apartar tampoco */
export function effectOn(
  item: Pick<UpcomingItem, 'kind' | 'amount' | 'accountId' | 'toAccountId'>,
  accounts: ReadonlySet<string>,
): number {
  const from = accounts.has(item.accountId);
  if (item.kind === 'in') return from ? item.amount : 0;
  if (item.kind === 'out') return from ? -item.amount : 0;
  if (item.kind === 'transfer') {
    const to = !!item.toAccountId && accounts.has(item.toAccountId);
    return from === to ? 0 : from ? -item.amount : item.amount;
  }
  return 0;
}

/** Saldo proyectado: el de hoy más lo programado que falta */
export function projectBalance(
  balance: number,
  items: UpcomingItem[],
  accounts: ReadonlySet<string>,
): number {
  return Math.round(items.reduce((s, i) => s + effectOn(i, accounts), balance) * 100) / 100;
}

/** Signo con que se muestra el monto de un programado en su propia cuenta */
export const scheduledSign = (kind: ScheduledKind): 1 | -1 | 0 =>
  kind === 'in' ? 1 : kind === 'set_aside' ? 0 : -1;
