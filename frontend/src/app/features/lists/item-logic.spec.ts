import { applyCompleted, applyPurchase, isPartial, remaining } from './item-logic';
import { ListItem } from './lists.models';

const leche: ListItem = {
  id: 'i1',
  text: 'Leche',
  note: null,
  amount: 2,
  unit: 'L',
  purchased: null,
  spent: null,
  category: null,
  assigneeId: null,
  dueDate: null,
  position: 1,
  completedAt: null,
  completedBy: null,
};
const ana = { id: 'u1', nickname: 'ana' };

describe('reglas de compras', () => {
  it('suma compras parciales hasta completar, acumulando lo pagado', () => {
    const half = applyPurchase(leche, 1, 1.5, ana);
    expect(isPartial(half)).toBe(true);
    expect(remaining(half)).toBe(1);
    expect(half.completedAt).toBeNull();

    const full = applyPurchase(half, 1, 1.25, ana);
    expect(full).toMatchObject({ purchased: 2, spent: 2.75, completedBy: ana });
    expect(isPartial(full)).toBe(false);
  });

  it('sin cantidad compra lo que falta; de más también completa', () => {
    expect(applyPurchase(leche, null, null, ana).purchased).toBe(2);
    expect(applyPurchase(leche, 5, null, ana).completedAt).not.toBeNull();
  });

  it('un ítem sin cantidad se completa con cualquier compra', () => {
    const pan = applyPurchase({ ...leche, amount: null, unit: null }, null, 3, ana);
    expect(pan.completedAt).not.toBeNull();
    expect(pan.spent).toBe(3);
  });

  it('desmarcar borra lo comprado; marcar cuenta como comprado todo', () => {
    const bought = applyCompleted(applyPurchase(leche, 1, 2, ana), true, ana);
    expect(bought.purchased).toBe(2);
    expect(applyCompleted(bought, false, ana)).toMatchObject({ purchased: null, spent: null, completedAt: null });
  });
});
