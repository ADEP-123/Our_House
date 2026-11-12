import { AccountSavings, Budget } from './finance.models';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "Recuerda que 8.000 son de ahorro": una salida (o parte de ella) se come lo apartado.
 * @param own al editar una salida, lo que ya restaba ella misma (vuelve a estar disponible)
 * @returns null si alcanza con el disponible o no hay ahorro en la cuenta
 */
export function savingsReminder(
  savings: AccountSavings | undefined,
  amount: number | null,
  own = 0,
) {
  if (!savings?.total || amount === null || amount <= 0) return null;
  const available = r2(savings.available + own);
  if (amount <= available) return null;
  return { saved: savings.total, available, projects: savings.projects };
}

/**
 * Umbral del presupuesto (80 o 100 %) que se cruza al sumar `add` a lo gastado.
 * @returns el más alto cruzado, o null si no se cruza ninguno
 */
export function budgetCrossing(
  budget: Pick<Budget, 'limit' | 'spent'> | undefined,
  add: number,
): 80 | 100 | null {
  if (!budget || add <= 0) return null;
  const before = (budget.spent / budget.limit) * 100;
  const after = ((budget.spent + add) / budget.limit) * 100;
  if (before < 100 && after >= 100) return 100;
  if (before < 80 && after >= 80) return 80;
  return null;
}

/** Avance hacia la meta, de 0 a 100 */
export const goalProgress = (saved: number, goal: number | null): number =>
  goal ? Math.min(100, Math.max(0, Math.round((saved / goal) * 100))) : 0;

/** Cuánto hay que apartar por mes para llegar a la meta en la fecha (null si no aplica) */
export function monthlyToGoal(
  saved: number,
  goal: number | null,
  targetDate: string | null,
  today: string,
): number | null {
  if (!goal || !targetDate || saved >= goal || targetDate <= today) return null;
  const [ty, tm] = targetDate.split('-').map(Number) as [number, number];
  const [y, m] = today.split('-').map(Number) as [number, number];
  const months = Math.max(1, (ty - y) * 12 + (tm - m));
  return Math.ceil(((goal - saved) / months) * 100) / 100;
}
