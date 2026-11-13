import {
  buildOverrides,
  creditUsage,
  localToday,
  movementCode,
  normalizePrefix,
  suggestPrefix,
} from './finance-logic';

describe('finanzas: prefijo de la cuenta', () => {
  it('sugiere iniciales o las dos primeras letras, sin tildes', () => {
    expect(suggestPrefix('Efectivo')).toBe('EF');
    expect(suggestPrefix('Banco Nu')).toBe('BN');
    expect(suggestPrefix('Cuenta de ahorro Viaje')).toBe('CDA');
    expect(suggestPrefix('Él')).toBe('EL');
    expect(suggestPrefix('  ')).toBe('C');
  });

  it('si ya existe agrega un número', () => {
    expect(suggestPrefix('Efectivo', ['EF'])).toBe('EF2');
    expect(suggestPrefix('Efectivo', ['ef', 'EF2'])).toBe('EF3');
    expect(suggestPrefix('Cuenta de ahorro Viaje', ['CDA'])).toBe('CDA2');
  });

  it('normaliza lo que escribe la persona', () => {
    expect(normalizePrefix('nu-1x')).toBe('NU1X');
    expect(normalizePrefix('ñandú')).toBe('NAND');
  });

  it('arma el ID visible', () => {
    expect(movementCode('T', 1)).toBe('T0001');
    expect(movementCode('EF', 286)).toBe('EF0286');
  });
});

describe('finanzas: utilidades', () => {
  it('fecha local de hoy', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('uso del cupo', () => {
    expect(creditUsage(250, 1000)).toBe(25);
    expect(creditUsage(1500, 1000)).toBe(100);
    expect(creditUsage(0, 0)).toBe(0);
    expect(creditUsage(10, 0)).toBe(100);
  });
});

describe('finanzas: borrar una categoría', () => {
  it('solo envía los movimientos con un destino distinto al de todos', () => {
    expect(buildOverrides({ m1: 'salud', m2: '', m3: 'otros', m4: 'ocio' }, 'otros')).toEqual([
      { movementId: 'm1', categoryId: 'salud' },
      { movementId: 'm4', categoryId: 'ocio' },
    ]);
    expect(buildOverrides({}, 'otros')).toEqual([]);
  });
});
