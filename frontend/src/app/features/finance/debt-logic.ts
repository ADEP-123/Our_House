import { Debt } from './finance.models';

/** Avance de lo pagado frente a lo que se llegó a deber (0-100) */
export const debtProgress = (d: Pick<Debt, 'paid' | 'total' | 'balance'>): number =>
  d.balance <= 0
    ? 100
    : d.total > 0
      ? Math.min(100, Math.round(((d.total - d.balance) / d.total) * 100))
      : 0;

/** Días hasta la fecha de pago (negativo: vencida) */
export function daysUntil(due: string, today: string): number {
  return Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/** Interés de un período sobre lo que falta (redondeado a centavos) */
export const interestOf = (balance: number, rate: number): number =>
  Math.round(balance * rate) / 100;

/** Activas primero (las que vencen antes arriba, sin fecha al final); luego las pagadas */
export function sortDebts(list: Debt[]): { active: Debt[]; paid: Debt[] } {
  const active = list
    .filter((d) => d.balance > 0)
    .sort(
      (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title),
    );
  const paid = list.filter((d) => d.balance <= 0);
  return { active, paid };
}
