import { describe, expect, it } from 'vitest';
import { buildPeriods, buildSummary, previousRange, type SummaryMovement } from '../src/lib/summary.js';

describe('resumen: períodos', () => {
  it('semanas desde el lunes, recortadas al rango', () => {
    expect(buildPeriods('2026-11-01', '2026-11-30', 'week')).toEqual([
      { start: '2026-11-01', end: '2026-11-01' },
      { start: '2026-11-02', end: '2026-11-08' },
      { start: '2026-11-09', end: '2026-11-15' },
      { start: '2026-11-16', end: '2026-11-22' },
      { start: '2026-11-23', end: '2026-11-29' },
      { start: '2026-11-30', end: '2026-11-30' },
    ]);
  });

  it('meses, trimestres y años', () => {
    expect(buildPeriods('2026-01-15', '2026-03-10', 'month').map((p) => `${p.start}..${p.end}`)).toEqual([
      '2026-01-15..2026-01-31',
      '2026-02-01..2026-02-28',
      '2026-03-01..2026-03-10',
    ]);
    expect(buildPeriods('2026-01-01', '2026-12-31', 'quarter')).toHaveLength(4);
    expect(buildPeriods('2025-06-01', '2026-02-01', 'year').map((p) => p.start)).toEqual(['2025-06-01', '2026-01-01']);
  });

  it('período anterior: mes, año o la misma cantidad de días', () => {
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousRange('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousRange('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(previousRange('2026-11-10', '2026-11-19')).toEqual({ from: '2026-10-31', to: '2026-11-09' });
  });
});

describe('resumen: totales', () => {
  const mov = (account_id: string, kind: SummaryMovement['kind'], amount: number, date: string, category_id: string | null = null): SummaryMovement => ({
    account_id,
    kind,
    amount,
    date,
    category_id,
  });
  const movements = [
    mov('nu', 'opening', 100, '2026-01-01'),
    mov('nu', 'in', 1000, '2026-11-02', 'ing'),
    mov('nu', 'out', 30, '2026-11-03', 'ali'),
    mov('nu', 'out', 20, '2026-11-12', 'ocio'),
    mov('nu', 'adjust', -5, '2026-11-12'),
    mov('nu', 'transfer_out', 200, '2026-11-15'),
    mov('visa', 'opening', -300, '2026-01-01'),
    mov('visa', 'transfer_in', 200, '2026-11-15'),
    mov('visa', 'out', 50, '2026-11-20', 'ali'),
    mov('nu', 'out', 70, '2026-10-05', 'ali'), // mes anterior
    mov('nu', 'in', 500, '2026-10-01', 'ing'),
  ];
  const summary = buildSummary({
    from: '2026-11-01',
    to: '2026-11-30',
    freq: 'week',
    accounts: [
      { id: 'nu', name: 'Nu', kind: 'bank', credit_limit: null },
      { id: 'visa', name: 'Visa', kind: 'credit', credit_limit: 1000 },
    ],
    categories: [
      { id: 'ing', name: 'Ingresos', icon: '💰', color: 'green' },
      { id: 'ali', name: 'Alimentación', icon: '🍽️', color: 'orange' },
      { id: 'ocio', name: 'Ocio', icon: '🎉', color: 'pink' },
    ],
    movements,
  });

  it('entradas y salidas sin saldo inicial, ni transferencias, ni ajustes (aparte)', () => {
    expect(summary.combined).toMatchObject({ income: 1000, expense: 100, net: 900, adjustments: -5, transfersIn: 200, transfersOut: 200 });
    expect(summary.combined.previous).toMatchObject({ income: 500, expense: 70, net: 430 });
  });

  it('categorías ordenadas por gasto', () => {
    expect(summary.combined.categories.map((c) => [c.name, c.expense, c.income])).toEqual([
      ['Alimentación', 80, 0],
      ['Ocio', 20, 0],
      ['Ingresos', 0, 1000],
    ]);
  });

  it('saldo al inicio, al final y por período (todo movimiento cuenta)', () => {
    // Antes de noviembre: 100 + 500 - 70 - 300 = 230
    expect(summary.combined.openingBalance).toBe(230);
    expect(summary.combined.closingBalance).toBe(1125);
    expect(summary.combined.periods.map((p) => p.balance)).toEqual([230, 1200, 1175, 1125, 1125, 1125]);
    expect(summary.combined.periods[1]).toMatchObject({ income: 1000, expense: 30, categories: { ing: { income: 1000, expense: 0 }, ali: { income: 0, expense: 30 } } });
  });

  it('por cuenta', () => {
    const visa = summary.byAccount.find((a) => a.accountId === 'visa')!;
    expect(visa).toMatchObject({ income: 0, expense: 50, transfersIn: 200, openingBalance: -300, closingBalance: -150 });
  });

  it('saldos: deuda de tarjetas, real sin tarjetas y completo con su disponible', () => {
    // Nu: 100 + 500 - 70 + 1000 - 30 - 20 - 5 - 200 = 1275; Visa: -300 + 200 - 50 = -150
    expect(summary.balances).toEqual({ debt: 150, real: 1275, complete: 1275 + 850 });
  });
});
