import { dayPassed, effectOn, monthlyStart, projectBalance } from './scheduled-logic';

describe('scheduled-logic', () => {
  it('primera fecha de un mensual', () => {
    expect(monthlyStart(15, '2026-11-11')).toBe('2026-11-15');
    expect(monthlyStart(11, '2026-11-11')).toBe('2026-11-11');
    expect(monthlyStart(5, '2026-11-11')).toBe('2026-12-05');
    expect(monthlyStart(5, '2026-11-11', true)).toBe('2026-11-05');
    expect(monthlyStart(31, '2026-11-11')).toBe('2026-11-30');
    expect(monthlyStart(5, '2026-12-20')).toBe('2027-01-05');
    expect(monthlyStart(31, '2027-01-31')).toBe('2027-01-31');
    expect(dayPassed(5, '2026-11-11')).toBe(true);
    expect(dayPassed(11, '2026-11-11')).toBe(false);
  });

  it('efecto de lo programado en el saldo de las cuentas elegidas', () => {
    const accounts = new Set(['nu', 'cash']);
    const base = { amount: 100, accountId: 'nu', toAccountId: null };
    expect(effectOn({ ...base, kind: 'in' }, accounts)).toBe(100);
    expect(effectOn({ ...base, kind: 'out' }, accounts)).toBe(-100);
    expect(effectOn({ ...base, kind: 'set_aside' }, accounts)).toBe(0);
    expect(effectOn({ ...base, kind: 'transfer', toAccountId: 'cash' }, accounts)).toBe(0);
    expect(effectOn({ ...base, kind: 'transfer', toAccountId: 'visa' }, accounts)).toBe(-100);
    expect(
      effectOn({ ...base, kind: 'transfer', accountId: 'visa', toAccountId: 'nu' }, accounts),
    ).toBe(100);
    expect(effectOn({ ...base, kind: 'out', accountId: 'visa' }, accounts)).toBe(0);
    const items = [
      {
        scheduleId: 'a',
        date: '2026-11-20',
        kind: 'out' as const,
        amount: 15.99,
        description: 'Netflix',
        mode: 'auto' as const,
        accountId: 'nu',
        accountName: 'Nu',
        toAccountId: null,
        toAccountName: null,
      },
      {
        scheduleId: 'b',
        date: '2026-11-30',
        kind: 'in' as const,
        amount: 2000,
        description: 'Sueldo',
        mode: 'auto' as const,
        accountId: 'nu',
        accountName: 'Nu',
        toAccountId: null,
        toAccountName: null,
      },
    ];
    expect(projectBalance(500, items, accounts)).toBe(2484.01);
  });
});
