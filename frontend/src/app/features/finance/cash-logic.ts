/** Billetes y monedas de una moneda, de mayor a menor */
export interface Denominations {
  bills: number[];
  coins: number[];
}

/**
 * Denominaciones en circulación de las monedas más usadas por los grupos. Si la moneda no está,
 * se cuenta con "Otros" y la calculadora.
 */
export const DENOMINATIONS: Record<string, Denominations> = {
  USD: { bills: [100, 50, 20, 10, 5, 2, 1], coins: [1, 0.5, 0.25, 0.1, 0.05, 0.01] },
  EUR: { bills: [500, 200, 100, 50, 20, 10, 5], coins: [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] },
  COP: { bills: [100000, 50000, 20000, 10000, 5000, 2000, 1000], coins: [1000, 500, 200, 100, 50] },
  MXN: { bills: [1000, 500, 200, 100, 50, 20], coins: [20, 10, 5, 2, 1, 0.5] },
  ARS: { bills: [20000, 10000, 2000, 1000, 500, 200, 100], coins: [] },
  CLP: { bills: [20000, 10000, 5000, 2000, 1000], coins: [500, 100, 50, 10] },
  PEN: { bills: [200, 100, 50, 20, 10], coins: [5, 2, 1, 0.5, 0.2, 0.1] },
  BRL: { bills: [200, 100, 50, 20, 10, 5, 2], coins: [1, 0.5, 0.25, 0.1, 0.05] },
  GBP: { bills: [50, 20, 10, 5], coins: [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] },
  CAD: { bills: [100, 50, 20, 10, 5], coins: [2, 1, 0.25, 0.1, 0.05] },
};

/** Una fila del conteo: billete o moneda, su valor y cuántos hay */
export interface CashRow {
  key: string;
  kind: 'bill' | 'coin';
  value: number;
}

export const cashRows = (currency: string): CashRow[] => {
  const d = DENOMINATIONS[currency.toUpperCase()];
  if (!d) return [];
  return [
    ...d.bills.map((value) => ({ key: `b${value}`, kind: 'bill' as const, value })),
    ...d.coins.map((value) => ({ key: `c${value}`, kind: 'coin' as const, value })),
  ];
};

/** Total contado: cada denominación por su cantidad, más lo suelto ("otros") */
export function cashTotal(rows: CashRow[], counts: Record<string, number>, others = 0): number {
  const cents = rows.reduce(
    (sum, r) => sum + Math.round(r.value * 100) * Math.max(0, counts[r.key] ?? 0),
    0,
  );
  return (cents + Math.round(others * 100)) / 100;
}

/** Valor de un billete o moneda para mostrar: sin decimales si es entero ("$100", "0,25 US$") */
export function denominationLabel(value: number, currency: string, locale: string): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  try {
    return value.toLocaleString(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return `${value.toLocaleString(locale)} ${currency}`;
  }
}

/** Tecla de la calculadora sobre el texto actual: C borra, ⌫ quita un carácter, el resto se agrega */
export function pressKey(text: string, key: string): string {
  if (key === 'C') return '';
  if (key === '⌫') return text.slice(0, -1);
  const operators = '+−×÷';
  // Dos operadores seguidos: el nuevo reemplaza al anterior (salvo el menos para un negativo)
  if (operators.includes(key) && operators.includes(text.slice(-1)) && key !== '−')
    return text.slice(0, -1) + key;
  return text + key;
}
