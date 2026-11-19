import { Debt } from './finance.models';
import { daysUntil, debtProgress, interestOf, sortDebts } from './debt-logic';

const debt = (p: Partial<Debt>): Debt =>
  ({ id: 'x', title: 'x', balance: 0, paid: 0, total: 0, dueDate: null, ...p }) as Debt;

describe('finanzas: deudas', () => {
  it('avance, días que faltan e interés', () => {
    expect(debtProgress({ paid: 250, total: 1015, balance: 765 })).toBe(25);
    expect(debtProgress({ paid: 0, total: 100, balance: 0 })).toBe(100);
    expect(daysUntil('2026-12-01', '2026-11-17')).toBe(14);
    expect(daysUntil('2026-11-14', '2026-11-17')).toBe(-3);
    expect(interestOf(765, 2)).toBe(15.3);
  });

  it('ordena: activas por fecha de pago y las pagadas aparte', () => {
    const { active, paid } = sortDebts([
      debt({ id: 'sin fecha', title: 'B', balance: 10 }),
      debt({ id: 'pronto', title: 'C', balance: 10, dueDate: '2026-11-20' }),
      debt({ id: 'pagada', title: 'A', balance: 0 }),
      debt({ id: 'después', title: 'A', balance: 10, dueDate: '2026-12-20' }),
    ]);
    expect(active.map((d) => d.id)).toEqual(['pronto', 'después', 'sin fecha']);
    expect(paid.map((d) => d.id)).toEqual(['pagada']);
  });
});
