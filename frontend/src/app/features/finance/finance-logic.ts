import { AccountKind } from './finance.models';

export const ACCOUNT_KINDS: { id: AccountKind; icon: string }[] = [
  { id: 'bank', icon: '🏦' },
  { id: 'cash', icon: '💵' },
  { id: 'credit', icon: '💳' },
  { id: 'savings', icon: '🐷' },
];

export const kindIcon = (kind: AccountKind): string =>
  ACCOUNT_KINDS.find((k) => k.id === kind)?.icon ?? '🏦';

/**
 * Prefijo sugerido para el ID de los movimientos a partir del nombre:
 * iniciales de cada palabra ("Banco Nu" → BN) o las dos primeras letras si es una sola ("Efectivo" → EF).
 * Si ya lo usa otra cuenta del grupo, se le agrega un número (EF2).
 */
export function suggestPrefix(name: string, taken: readonly string[] = []): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  let base =
    words.length > 1
      ? words
          .map((w) => w[0])
          .join('')
          .slice(0, 3)
      : (words[0] ?? '').slice(0, 2);
  if (!base) base = 'C';
  const used = new Set(taken.map((t) => t.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 4 - String(n).length)}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

/** Prefijo válido: 1 a 4 letras o números, en mayúsculas */
export const normalizePrefix = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);

/** ID visible de un movimiento: prefijo + 4 dígitos (T0001) */
export const movementCode = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(4, '0')}`;

/** Fecha de hoy en la zona del dispositivo, como AAAA-MM-DD */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Porcentaje del cupo usado (0 a 100) para la barra de la tarjeta */
export const creditUsage = (debt: number, limit: number): number =>
  limit <= 0 ? (debt > 0 ? 100 : 0) : Math.min(100, Math.max(0, Math.round((debt / limit) * 100)));
