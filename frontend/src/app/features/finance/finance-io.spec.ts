import { ExportData } from './finance.models';
import {
  buildCsv,
  buildWorkbook,
  parseColor,
  parseCsv,
  parseDate,
  parseWorkbook,
} from './finance-io';

const data: ExportData = {
  currency: 'USD',
  from: null,
  to: null,
  accounts: [
    {
      name: 'Nu',
      prefix: 'T',
      kind: 'bank',
      description: null,
      creditLimit: null,
      balance: 845,
      archived: false,
    },
  ],
  categories: [{ name: 'Alimentación', icon: 'food', color: 'orange', active: true }],
  movements: [
    {
      code: 'T0001',
      account: 'Nu',
      date: '2026-01-01',
      description: 'Saldo inicial',
      category: null,
      kind: 'opening',
      amount: 100,
      destination: null,
    },
    {
      code: 'T0002',
      account: 'Nu',
      date: '2026-11-05',
      description: 'Mercado; "grande"',
      category: 'Alimentación',
      kind: 'out',
      amount: 1318.71,
      destination: null,
    },
    {
      code: 'T0003',
      account: 'Nu',
      date: '2026-11-06',
      description: 'Pago',
      category: null,
      kind: 'transfer',
      amount: 200,
      destination: 'Visa',
    },
  ],
};

describe('finance-io', () => {
  it('lee fechas de Excel, números de serie y texto según el idioma', () => {
    expect(parseDate(new Date('2026-03-25T00:00:00Z'))).toBe('2026-03-25');
    expect(parseDate(46106)).toBe('2026-03-25');
    expect(parseDate('2026-11-05')).toBe('2026-11-05');
    expect(parseDate('5/11/2026', 'es')).toBe('2026-11-05');
    expect(parseDate('11/5/2026', 'en')).toBe('2026-11-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('mañana')).toBeNull();
  });

  it('colores por nombre o el más parecido de la paleta', () => {
    expect(parseColor('Naranja')).toBe('orange');
    expect(parseColor('teal')).toBe('teal');
    expect(parseColor('#E07A5F')).toBe('orange');
    expect(parseColor('#4C78A8')).toBe('blue');
    expect(parseColor('fucsia')).toBeNull();
  });

  it('lee las tres hojas en español, con columnas en otro orden y errores por fila', () => {
    const parsed = parseWorkbook(
      [
        { sheet: 'Instrucciones', data: [['texto']] },
        {
          sheet: 'Movimientos',
          data: [
            [
              'Tipo',
              'Monto',
              'ID',
              'Cuenta',
              'Fecha',
              'Descripción',
              'Categoría',
              'Cuenta destino',
            ],
            [
              'Salida',
              -30,
              't0005',
              'Nu',
              new Date('2026-11-05T00:00:00Z'),
              'Mercado',
              'Alimentación',
              null,
            ],
            ['Ajuste', '-5,50', null, 'Nu', '06/11/2026', 'Ajuste', null, null],
            [null, null, null, null, null, null, null, null],
            ['Regalo', 5, null, 'Nu', '2026-11-07', 'X', null, null],
            ['Entrada', 'mucho', null, 'Nu', '2026-11-07', 'X', 'Ingresos', null],
            ['Transferencia', 200, null, 'Nu', '2026-11-08', 'Pago Visa', null, 'Visa'],
          ],
        },
        {
          sheet: 'Cuentas',
          data: [
            ['Cuenta', 'Prefijo', 'Tipo de cuenta', 'Descripción', 'Cupo (solo crédito)'],
            ['Visa', 'v', 'Tarjeta de crédito', null, 1000],
            ['Raro', null, 'Bitcoin', null, null],
          ],
        },
        {
          sheet: 'Categorías',
          data: [
            ['Categoría', 'Ícono', 'Color', 'Activa'],
            ['Mascotas', '🐶', 'turquesa', 'Sí'],
            ['Viejo', 'no-es-icono', '#E07A5F', 'No'],
          ],
        },
      ],
      'es',
    );
    expect(parsed.found).toEqual(['accounts', 'categories', 'movements']);
    expect(parsed.payload.movements).toEqual([
      {
        row: 2,
        code: 'T0005',
        account: 'Nu',
        date: '2026-11-05',
        description: 'Mercado',
        category: 'Alimentación',
        kind: 'out',
        amount: 30,
        destination: null,
      },
      {
        row: 3,
        code: null,
        account: 'Nu',
        date: '2026-11-06',
        description: 'Ajuste',
        category: null,
        kind: 'adjust',
        amount: -5.5,
        destination: null,
      },
      {
        row: 7,
        code: null,
        account: 'Nu',
        date: '2026-11-08',
        description: 'Pago Visa',
        category: null,
        kind: 'transfer',
        amount: 200,
        destination: 'Visa',
      },
    ]);
    expect(parsed.payload.accounts).toEqual([
      { row: 2, name: 'Visa', prefix: 'V', kind: 'credit', description: null, creditLimit: 1000 },
    ]);
    expect(parsed.payload.categories).toEqual([
      { row: 2, name: 'Mascotas', icon: '🐶', color: 'teal', active: true },
      { row: 3, name: 'Viejo', icon: null, color: 'orange', active: false },
    ]);
    expect(parsed.issues.map((i) => `${i.sheet}:${i.row}:${i.code}`)).toEqual([
      'accounts:3:IMPORT_ACCOUNT_KIND_INVALID',
      'movements:5:IMPORT_KIND_INVALID',
      'movements:6:IMPORT_AMOUNT_INVALID',
    ]);
  });

  it('avisa si faltan columnas obligatorias', () => {
    const parsed = parseWorkbook(
      [{ sheet: 'Movements', data: [['ID', 'Account', 'Amount']] }],
      'en',
    );
    expect(parsed.issues).toEqual([
      {
        sheet: 'file',
        row: 0,
        code: 'IMPORT_MISSING_COLUMNS',
        params: { sheet: 'Movements', columns: 'Date, Description, Type' },
      },
    ]);
  });

  it('el CSV exportado se vuelve a leer igual (español e inglés)', () => {
    for (const locale of ['es', 'en']) {
      const csv = buildCsv(data, locale);
      expect(csv.startsWith('﻿')).toBe(true);
      const parsed = parseWorkbook([{ sheet: 'export.csv', data: parseCsv(csv) }], locale);
      expect(parsed.issues).toEqual([]);
      expect(
        parsed.payload.movements.map((m) => [
          m.code,
          m.kind,
          m.amount,
          m.description,
          m.destination,
        ]),
      ).toEqual([
        ['T0001', 'opening', 100, 'Saldo inicial', null],
        ['T0002', 'out', 1318.71, 'Mercado; "grande"', null],
        ['T0003', 'transfer', 200, 'Pago', 'Visa'],
      ]);
    }
  });

  it('arma el Excel con sus hojas en el idioma de la persona', () => {
    const es = buildWorkbook(data, 'es');
    expect(es.map((s) => s.sheet)).toEqual([
      'Movimientos',
      'Cuentas',
      'Categorías',
      'Instrucciones',
    ]);
    expect(es[0]!.data[2]![5] as string).toBe('Salida');
    expect(es[2]!.data[1]).toEqual(['Alimentación', '🍽️', 'naranja', 'Sí']);
    const en = buildWorkbook(data, 'en');
    expect(en.map((s) => s.sheet)).toEqual(['Movements', 'Accounts', 'Categories', 'Instructions']);
  });
});
