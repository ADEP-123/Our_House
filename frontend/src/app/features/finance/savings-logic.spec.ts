import { budgetCrossing, goalProgress, monthlyToGoal, savingsReminder } from './savings-logic';

describe('savings-logic', () => {
  const savings = {
    total: 8000,
    available: 2000,
    projects: [{ id: 'v', name: 'Viaje', icon: '✈️', amount: 8000 }],
  };

  it('recuerda el ahorro solo si la salida pasa del disponible', () => {
    expect(savingsReminder(savings, 1500)).toBeNull();
    expect(savingsReminder(savings, 2500)).toEqual({
      saved: 8000,
      available: 2000,
      projects: savings.projects,
    });
    // Al editar, lo que ya restaba la salida vuelve a estar disponible
    expect(savingsReminder(savings, 2500, 600)).toBeNull();
    expect(savingsReminder({ total: 0, available: 50, projects: [] }, 100)).toBeNull();
    expect(savingsReminder(savings, null)).toBeNull();
  });

  it('cruces del presupuesto al 80 y al 100 %', () => {
    expect(budgetCrossing({ limit: 100, spent: 70 }, 5)).toBeNull();
    expect(budgetCrossing({ limit: 100, spent: 70 }, 15)).toBe(80);
    expect(budgetCrossing({ limit: 100, spent: 70 }, 40)).toBe(100);
    expect(budgetCrossing({ limit: 100, spent: 85 }, 5)).toBeNull();
    expect(budgetCrossing({ limit: 100, spent: 120 }, 5)).toBeNull();
    expect(budgetCrossing(undefined, 50)).toBeNull();
  });

  it('avance y aporte mensual para llegar a la meta', () => {
    expect(goalProgress(250, 1000)).toBe(25);
    expect(goalProgress(1500, 1000)).toBe(100);
    expect(goalProgress(10, null)).toBe(0);
    expect(monthlyToGoal(250, 1000, '2027-05-01', '2026-11-11')).toBe(125);
    expect(monthlyToGoal(250, 1000, '2026-11-30', '2026-11-11')).toBe(750);
    expect(monthlyToGoal(1000, 1000, '2027-05-01', '2026-11-11')).toBeNull();
    expect(monthlyToGoal(250, 1000, null, '2026-11-11')).toBeNull();
  });
});
