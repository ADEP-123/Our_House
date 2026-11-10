import { effectiveTheme, seasonFor, seasonUntil } from './seasons';
import { DEFAULT_THEME, PRESETS } from './themes';

const day = (month: number, date: number, year = 2026) => new Date(year, month - 1, date, 12);

describe('temporadas', () => {
  it('las fiestas van antes que las estaciones', () => {
    expect(seasonFor(day(12, 10), 'north')).toBe('navidad');
    expect(seasonFor(day(12, 31), 'south')).toBe('anionuevo');
    expect(seasonFor(day(1, 6), 'north')).toBe('anionuevo');
    expect(seasonFor(day(10, 31), 'north')).toBe('halloween');
    expect(seasonFor(day(2, 14), 'north')).toBe('amor');
  });

  it('las estaciones dependen del hemisferio', () => {
    expect(seasonFor(day(7, 15), 'north')).toBe('verano');
    expect(seasonFor(day(7, 15), 'south')).toBe('invierno');
    expect(seasonFor(day(11, 9), 'north')).toBe('otono');
    expect(seasonFor(day(11, 9), 'south')).toBe('primavera');
    expect(seasonFor(day(1, 20), 'north')).toBe('invierno');
    expect(seasonFor(day(4, 1), 'south')).toBe('otono');
  });

  it('dice hasta cuándo dura el tema de hoy', () => {
    expect(seasonUntil(day(11, 9), 'north').toDateString()).toBe(day(11, 30).toDateString());
    expect(seasonUntil(day(12, 3), 'north').toDateString()).toBe(day(12, 26).toDateString());
    expect(seasonUntil(day(12, 28), 'north').toDateString()).toBe(day(1, 6, 2027).toDateString());
  });

  it('en modo automático se ve el tema de la temporada, en su versión clara u oscura', () => {
    const theme = {
      ...DEFAULT_THEME,
      auto: { enabled: true, hemisphere: 'north' as const, dark: true },
    };
    expect(effectiveTheme(theme, day(12, 10))).toMatchObject({
      preset: 'navidad-oscuro',
      colors: PRESETS['navidad-oscuro'],
    });
    expect(
      effectiveTheme({ ...theme, auto: { ...theme.auto, enabled: false } }, day(12, 10)).preset,
    ).toBe('claro');
  });
});
