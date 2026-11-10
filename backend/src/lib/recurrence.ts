/**
 * Repetición de tareas. Fechas como texto 'AAAA-MM-DD' (días de calendario, sin hora ni zona).
 *
 * - schedule: fechas fijas contadas desde la fecha de inicio (regar los lunes es siempre lunes).
 * - completion: la siguiente se cuenta desde el día en que se completó (cambiar el filtro 30 días después).
 */
export const REPEAT_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RepeatFreq = (typeof REPEAT_FREQS)[number];

export interface RepeatRule {
  freq: RepeatFreq;
  /** Cada cuántos días / semanas / meses / años (1 = cada uno) */
  interval: number;
  /** Solo semanal: días de la semana (0 = domingo … 6 = sábado). Vacío = el mismo día de la semana del inicio */
  weekdays?: number[];
  from: 'schedule' | 'completion';
  /** Primera fecha: fija el día del mes / de la semana y el ritmo de las semanas */
  start: string;
  /** Termina: hasta esta fecha (inclusive) o después de N veces hechas */
  until?: string | null;
  count?: number | null;
}

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => toDate(toTime(date) + days * DAY);
const weekday = (date: string) => new Date(toTime(date)).getUTCDay();
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Mismo día del mes que `day`, en el mes indicado (si no existe, el último: 31 → 30 o 28) */
function onDay(year: number, month: number, day: number): string {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return toDate(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
}

/** Lunes de la semana de una fecha (para contar semanas de a N) */
const weekStart = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** Siguiente fecha estrictamente después de `after`, según la regla */
export function nextDate(rule: RepeatRule, after: string): string {
  const n = Math.max(1, Math.floor(rule.interval));
  const [sy, sm, sd] = rule.start.split('-').map(Number) as [number, number, number];

  if (rule.from === 'completion') {
    // Desde el día en que se completó: simplemente sumar el intervalo
    const [y, m] = after.split('-').map(Number) as [number, number];
    if (rule.freq === 'daily') return addDays(after, n);
    if (rule.freq === 'weekly') return addDays(after, 7 * n);
    if (rule.freq === 'monthly') return onDay(y, m - 1 + n, Number(after.slice(8)));
    return onDay(y + n, m - 1, Number(after.slice(8)));
  }

  switch (rule.freq) {
    case 'daily': {
      // Días desde el inicio, de a n
      const passed = Math.floor((toTime(after) - toTime(rule.start)) / DAY);
      const steps = passed < 0 ? 0 : Math.floor(passed / n) + 1;
      return addDays(rule.start, steps * n);
    }
    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [weekday(rule.start)];
      const anchor = weekStart(rule.start);
      // Busca día a día (como mucho 2 ciclos de n semanas) el primero que cae en un día elegido y en una semana que toca
      for (let i = 1; i <= 14 * n + 7; i++) {
        const candidate = addDays(after, i);
        if (candidate < rule.start) continue;
        const weeks = Math.round((toTime(weekStart(candidate)) - toTime(anchor)) / (7 * DAY));
        if (weeks % n === 0 && days.includes(weekday(candidate))) return candidate;
      }
      return addDays(after, 7 * n);
    }
    case 'monthly': {
      const [ay, am] = after.split('-').map(Number) as [number, number];
      let months = (ay - sy) * 12 + (am - sm);
      months = Math.max(0, Math.ceil(months / n) * n);
      let candidate = onDay(sy, sm - 1 + months, sd);
      while (candidate <= after) {
        months += n;
        candidate = onDay(sy, sm - 1 + months, sd);
      }
      return candidate;
    }
    case 'yearly': {
      const ay = Number(after.slice(0, 4));
      let years = Math.max(0, Math.ceil((ay - sy) / n) * n);
      let candidate = onDay(sy + years, sm - 1, sd);
      while (candidate <= after) {
        years += n;
        candidate = onDay(sy + years, sm - 1, sd);
      }
      return candidate;
    }
  }
}

/** ¿Se terminó la repetición? (la próxima fecha pasa del límite, o ya se hizo las veces pedidas) */
export function finished(rule: RepeatRule, next: string, timesDone: number): boolean {
  if (rule.until && next > rule.until) return true;
  return !!rule.count && timesDone >= rule.count;
}

/** Fecha de hoy en una zona horaria */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
