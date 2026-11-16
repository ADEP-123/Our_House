import { cashRows, cashTotal, denominationLabel, pressKey } from './cash-logic';
import { parseAmount } from './movement-logic';

describe('finanzas: contar efectivo', () => {
  it('trae billetes y monedas de la moneda del grupo', () => {
    const rows = cashRows('cop');
    expect(rows[0]).toEqual({ key: 'b100000', kind: 'bill', value: 100000 });
    expect(rows.filter((r) => r.kind === 'coin').map((r) => r.value)).toEqual([
      1000, 500, 200, 100, 50,
    ]);
    expect(cashRows('XYZ')).toEqual([]);
  });

  it('suma cada denominación por su cantidad, sin errores de centavos', () => {
    const rows = cashRows('USD');
    expect(cashTotal(rows, { b20: 3, b1: 2, 'c0.1': 3, 'c0.05': 1 }, 0.02)).toBe(62.37);
    expect(cashTotal(rows, { b100: -2 })).toBe(0);
    expect(cashTotal(cashRows('COP'), { b50000: 2, c500: 3 }, 1000)).toBe(102500);
  });

  it('muestra el valor sin decimales si es entero', () => {
    expect(denominationLabel(100000, 'COP', 'es-CO')).toContain('100.000');
    expect(denominationLabel(0.25, 'USD', 'en-US')).toBe('$0.25');
    expect(denominationLabel(20, 'USD', 'en-US')).toBe('$20');
  });

  it('la calculadora arma la cuenta con las teclas', () => {
    let t = '';
    for (const k of ['1', '2', '+', '×', '3', '⌫', '4', '−', '−', '2']) t = pressKey(t, k);
    expect(t).toBe('12×4−−2');
    expect(parseAmount(t)).toBe(50);
    expect(pressKey('12', 'C')).toBe('');
  });
});
