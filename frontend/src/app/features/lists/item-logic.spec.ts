import { applyCompleted, applyPurchase, applyToggle, isPartial, remaining, removeItem } from './item-logic';
import { ListItem } from './lists.models';

const leche: ListItem = {
  id: 'i1',
  parentId: null,
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

describe('reglas de subtareas', () => {
  const task = (id: string, parentId: string | null = null, done = false): ListItem => ({
    ...leche,
    id,
    parentId,
    amount: null,
    unit: null,
    completedAt: done ? '2026-11-01T10:00:00.000Z' : null,
  });

  it('la tarea se completa al terminar la última subtarea y se reabre al desmarcar una', () => {
    let items = [task('t'), task('a', 't'), task('b', 't', true)];
    items = applyToggle(items, 'a', true, ana);
    expect(items.find((i) => i.id === 't')!.completedAt).not.toBeNull();
    items = applyToggle(items, 'b', false, ana);
    expect(items.find((i) => i.id === 't')!.completedAt).toBeNull();
  });

  it('completar la tarea completa sus subtareas; desmarcarla no las toca', () => {
    let items = applyToggle([task('t'), task('a', 't'), task('b', 't')], 't', true, ana);
    expect(items.every((i) => i.completedAt)).toBe(true);
    items = applyToggle(items, 't', false, ana);
    expect(items.filter((i) => i.completedAt).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('borrar la tarea borra sus subtareas; borrar la última pendiente completa la tarea', () => {
    expect(removeItem([task('t'), task('a', 't'), task('x')], 't', ana).map((i) => i.id)).toEqual(['x']);
    const items = removeItem([task('t'), task('a', 't', true), task('b', 't')], 'b', ana);
    expect(items.find((i) => i.id === 't')!.completedAt).not.toBeNull();
  });
});
