import {
  EMPTY_FILTERS,
  amountForInput,
  filterMovements,
  hasFilters,
  parseAmount,
  recomputeBalances,
  signOf,
  TRANSFERS_FILTER,
  withBalance,
} from './movement-logic';
import { Account, Movement } from './finance.models';

const mov = (code: string, signedAmount: number, extra: Partial<Movement> = {}): Movement => ({
  id: code,
  code,
  number: 1,
  kind: signedAmount >= 0 ? 'in' : 'out',
  amount: Math.abs(signedAmount),
  signedAmount,
  date: '2026-11-01',
  description: code,
  category: null,
  createdBy: null,
  edited: false,
  balance: 0,
  createdAt: '',
  ...extra,
});

describe('finanzas: montos escritos a mano', () => {
  it('entiende punto o coma decimal y separadores de miles', () => {
    expect(parseAmount('1234.5')).toBe(1234.5);
    expect(parseAmount('1234,5')).toBe(1234.5);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('4.276.897')).toBe(4276897);
    expect(parseAmount('1,234,567')).toBe(1234567);
    expect(parseAmount('26675,06')).toBe(26675.06);
    expect(parseAmount('30.25')).toBe(30.25);
    expect(parseAmount('$ 20')).toBe(20);
    expect(parseAmount('0,5')).toBe(0.5);
    expect(parseAmount('-5,5')).toBe(-5.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('un solo separador con 3 cifras depende del idioma', () => {
    expect(parseAmount('1.500', 'es')).toBe(1500);
    expect(parseAmount('1,500', 'es')).toBe(1.5);
    expect(parseAmount('1,500', 'en')).toBe(1500);
    expect(parseAmount('1.500', 'en')).toBe(1.5);
    expect(parseAmount('12.5000', 'es')).toBe(12.5);
  });
});

describe('finanzas: monto en un campo editable', () => {
  it('se muestra con el separador del idioma y se vuelve a leer igual', () => {
    expect(amountForInput(1552.25, 'es')).toBe('1552,25');
    expect(amountForInput(1552.25, 'en')).toBe('1552.25');
    expect(amountForInput(-14.5, 'es')).toBe('-14,5');
    expect(amountForInput(1500, 'es')).toBe('1500');
    for (const n of [1552.25, 1500, 0.5, -14.5, 1234567.89]) {
      expect(parseAmount(amountForInput(n, 'es'), 'es')).toBe(n);
      expect(parseAmount(amountForInput(n, 'en'), 'en')).toBe(n);
    }
  });
});

describe('finanzas: filtros de movimientos', () => {
  const ocio = { id: 'c1', name: 'Ocio', icon: '🎉', color: 'pink' };
  const list = [
    mov('T0001', 100, { kind: 'opening', description: 'Saldo inicial', date: '2026-01-01' }),
    mov('T0002', -20, { description: 'Café Alicia', category: ocio, date: '2026-10-05' }),
    mov('T0003', 50, { description: 'Trabajo Claudia', date: '2026-11-02' }),
    mov('T0004', -5.5, { kind: 'adjust', description: 'Ajuste', date: '2026-11-03' }),
  ];

  it('sin filtros: todo, con entradas, salidas y neto', () => {
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(filterMovements(list, EMPTY_FILTERS).totals).toEqual({
      count: 4,
      income: 150,
      expense: 25.5,
      net: 124.5,
    });
  });

  it('texto sin tildes ni mayúsculas, también por ID y categoría', () => {
    expect(
      filterMovements(list, { ...EMPTY_FILTERS, text: 'cafe' }).rows.map((m) => m.code),
    ).toEqual(['T0002']);
    expect(
      filterMovements(list, { ...EMPTY_FILTERS, text: 't0003' }).rows.map((m) => m.code),
    ).toEqual(['T0003']);
    expect(
      filterMovements(list, { ...EMPTY_FILTERS, text: 'ocio' }).rows.map((m) => m.code),
    ).toEqual(['T0002']);
  });

  it('categoría, entradas/salidas y fechas', () => {
    expect(filterMovements(list, { ...EMPTY_FILTERS, categoryId: 'c1' }).totals).toEqual({
      count: 1,
      income: 0,
      expense: 20,
      net: -20,
    });
    expect(
      filterMovements(list, { ...EMPTY_FILTERS, kind: 'out' }).rows.map((m) => m.code),
    ).toEqual(['T0002', 'T0004']);
    const nov = { ...EMPTY_FILTERS, from: '2026-11-01', to: '2026-11-30' };
    expect(hasFilters(nov)).toBe(true);
    expect(filterMovements(list, nov).rows.map((m) => m.code)).toEqual(['T0003', 'T0004']);
  });
});

describe('finanzas: copia local sin conexión', () => {
  it('recalcula el saldo acumulado por fecha, creación y número', () => {
    const list = [
      mov('T0003', -30, { date: '2026-11-05', createdAt: '2026-11-05T10:00:00Z', number: 3 }),
      mov('', -10, {
        date: '2026-01-15',
        createdAt: '2026-11-10T09:00:00Z',
        number: 0,
        pending: true,
      }),
      mov('T0001', 100, { date: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', number: 1 }),
      mov('T0002', 50, { date: '2026-11-05', createdAt: '2026-11-05T09:00:00Z', number: 2 }),
    ];
    expect(recomputeBalances(list).map((m) => [m.code, m.balance])).toEqual([
      ['T0001', 100],
      ['', 90],
      ['T0002', 140],
      ['T0003', 110],
    ]);
  });

  it('actualiza deuda y disponible de una tarjeta', () => {
    const card = {
      balance: 0,
      credit: { limit: 1000, debt: 0, available: 1000, overLimit: false },
    } as Account;
    expect(withBalance(card, -1200.5).credit).toEqual({
      limit: 1000,
      debt: 1200.5,
      available: -200.5,
      overLimit: true,
    });
    const bank = { balance: 0, credit: null } as Account;
    expect(withBalance(bank, 12.345)).toEqual({ balance: 12.35, credit: null });
  });
});

describe('finanzas: transferencias', () => {
  it('signo según el tipo', () => {
    expect(signOf('out', 5)).toBe(-5);
    expect(signOf('transfer_out', 5)).toBe(-5);
    expect(signOf('transfer_in', 5)).toBe(5);
    expect(signOf('in', 5)).toBe(5);
    expect(signOf('adjust', -3)).toBe(-3);
  });

  it('el filtro "Transferencias" muestra solo esas', () => {
    const list = [
      mov('T0002', -20, { description: 'Café' }),
      mov('T0003', -50, {
        kind: 'transfer_out',
        transfer: { id: 't', accountId: 'v', accountName: 'Visa', code: 'V0002' },
      }),
    ];
    expect(
      filterMovements(list, { ...EMPTY_FILTERS, categoryId: TRANSFERS_FILTER }).rows.map(
        (m) => m.code,
      ),
    ).toEqual(['T0003']);
  });
});
