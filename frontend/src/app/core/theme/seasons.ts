import { PRESETS, seasonalPreset, type Hemisphere, type SeasonalId, type Theme } from './themes';

/** Fiestas: [mes, día] de inicio y fin, ambos incluidos (meses de 1 a 12). Van antes que las estaciones. */
const FESTIVITY_DATES: [SeasonalId, [number, number], [number, number]][] = [
  ['halloween', [10, 15], [10, 31]],
  ['navidad', [12, 1], [12, 26]],
  ['anionuevo', [12, 27], [1, 6]],
  ['amor', [2, 1], [2, 14]],
];

/** Estaciones por meses completos (hemisferio norte); en el sur van corridas seis meses */
const NORTH_SEASONS: SeasonalId[] = [
  'invierno',
  'invierno',
  'primavera',
  'primavera',
  'primavera',
  'verano',
  'verano',
  'verano',
  'otono',
  'otono',
  'otono',
  'invierno',
];

const inRange = (
  month: number,
  day: number,
  [m1, d1]: [number, number],
  [m2, d2]: [number, number],
) => {
  const value = month * 100 + day;
  const from = m1 * 100 + d1;
  const to = m2 * 100 + d2;
  // Un rango que cruza el año (27 dic – 6 ene)
  return from <= to ? value >= from && value <= to : value >= from || value <= to;
};

/** Tema de temporada para un día (fecha local de quien mira) */
export function seasonFor(date: Date, hemisphere: Hemisphere): SeasonalId {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const festivity = FESTIVITY_DATES.find(([, from, to]) => inRange(month, day, from, to));
  if (festivity) return festivity[0];
  const index = hemisphere === 'north' ? month - 1 : (month + 5) % 12;
  return NORTH_SEASONS[index]!;
}

/** Hasta qué día dura el tema de hoy */
export function seasonUntil(date: Date, hemisphere: Hemisphere): Date {
  const current = seasonFor(date, hemisphere);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let i = 0; i < 366; i++) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    if (seasonFor(next, hemisphere) !== current) return day;
    day.setDate(day.getDate() + 1);
  }
  return day;
}

/** El tema que se ve hoy: el elegido o, en modo automático, el de la temporada (con el patrón elegido) */
export function effectiveTheme(theme: Theme, date = new Date()): Theme {
  const auto = theme.auto;
  if (!auto?.enabled) return theme;
  const preset = seasonalPreset(seasonFor(date, auto.hemisphere), auto.dark);
  return { ...theme, preset, colors: PRESETS[preset] };
}
