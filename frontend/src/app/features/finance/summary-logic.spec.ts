import {
  defaultConfig,
  niceMax,
  niceTicks,
  pctChange,
  periodCount,
  periodLabel,
  rangeOf,
  suggestedFreq,
} from './summary-logic';

describe('resumen: período elegido', () => {
  it('mes, año y rango', () => {
    expect(defaultConfig(new Date(2026, 10, 10))).toMatchObject({
      mode: 'month',
      month: '2026-11',
      freq: 'week',
      view: 'combined',
    });
    expect(rangeOf({ ...defaultConfig(), mode: 'month', month: '2026-02' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(rangeOf({ ...defaultConfig(), mode: 'year', year: 2026 })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(
      rangeOf({ ...defaultConfig(), mode: 'range', from: '2026-11-30', to: '2026-03-01' }),
    ).toEqual({ from: '2026-03-01', to: '2026-11-30' });
  });

  it('frecuencia sugerida y cantidad de columnas', () => {
    expect(suggestedFreq('2026-11-01', '2026-11-30')).toBe('week');
    expect(suggestedFreq('2026-01-01', '2026-12-31')).toBe('month');
    expect(suggestedFreq('2020-01-01', '2026-12-31')).toBe('quarter');
    expect(periodCount('2026-01-01', '2026-12-31', 'week')).toBeGreaterThanOrEqual(53);
    expect(periodCount('2020-01-01', '2026-12-31', 'week')).toBeGreaterThan(120);
  });
});

describe('resumen: etiquetas y números', () => {
  it('nombres de columnas', () => {
    expect(periodLabel('2026-11-02', '2026-11-08', 'week', 'es', false)).toBe('2–8 nov');
    expect(periodLabel('2026-11-01', '2026-11-01', 'week', 'es', false)).toBe('1 nov');
    expect(periodLabel('2026-10-26', '2026-11-01', 'week', 'es', false)).toBe('26 oct–1 nov');
    expect(periodLabel('2026-11-01', '2026-11-30', 'month', 'es', false)).toBe('nov');
    expect(periodLabel('2026-11-01', '2026-11-30', 'month', 'en', true)).toBe('Nov 26');
    expect(periodLabel('2026-04-01', '2026-06-30', 'quarter', 'es', false)).toBe('T2 2026');
    expect(periodLabel('2026-04-01', '2026-06-30', 'quarter', 'en', false)).toBe('Q2 2026');
    expect(periodLabel('2026-01-01', '2026-12-31', 'year', 'es', false)).toBe('2026');
  });

  it('cambio frente al período anterior y tope del eje', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(-50, -100)).toBe(50);
    expect(pctChange(10, 0)).toBeNull();
    expect(niceMax(5070)).toBe(6000);
    expect(niceTicks(2500)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(niceTicks(6000)).toEqual([0, 1500, 3000, 4500, 6000]);
    expect([niceMax(0), niceMax(7), niceMax(1300), niceMax(240), niceMax(19)]).toEqual([
      1, 8, 2000, 250, 20,
    ]);
  });
});
