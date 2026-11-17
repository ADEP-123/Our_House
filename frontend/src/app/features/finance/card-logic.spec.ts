import { cardCycle, cardPayment, cutBefore, nextDue } from './card-logic';

const movements = [
  { date: '2026-10-01', kind: 'opening', signedAmount: -300 },
  { date: '2026-10-20', kind: 'out', signedAmount: -200 },
  { date: '2026-11-02', kind: 'out', signedAmount: -100 },
  { date: '2026-11-05', kind: 'transfer_in', signedAmount: 150 },
];

describe('finanzas: pago de tarjetas (igual que el backend)', () => {
  it('fechas de pago y de corte en meses cortos', () => {
    expect(nextDue(31, '2026-02-10')).toBe('2026-02-28');
    expect(nextDue(15, '2026-11-16')).toBe('2026-12-15');
    expect(cutBefore('2026-11-15', 28)).toBe('2026-10-28');
    expect(cutBefore('2026-11-20', 5)).toBe('2026-11-05');
  });

  it('con corte: deuda al corte menos los pagos de después', () => {
    expect(cardCycle({ paymentDay: 15, cutDay: 28 }, '2026-11-15', movements, '2026-11-12')).toEqual({
      due: '2026-11-15',
      cut: '2026-10-28',
      closed: true,
      statement: 500,
      paid: 150,
      pending: 350,
      debt: 450,
    });
  });

  it('la hoja: próxima fecha, días que faltan y sin día de pago no muestra nada', () => {
    const p = cardPayment({ paymentDay: 15, cutDay: null }, movements, '2026-11-12')!;
    expect(p).toMatchObject({ paymentDay: 15, daysLeft: 3, cycle: { pending: 450 } });
    expect(cardPayment({ paymentDay: 15, cutDay: 28 }, movements, '2026-11-15')!.daysLeft).toBe(0);
    expect(cardPayment({ paymentDay: null, cutDay: null }, movements, '2026-11-12')).toBeNull();
  });
});
