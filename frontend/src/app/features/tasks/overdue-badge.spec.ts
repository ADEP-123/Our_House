import { countOverdue, titleWith } from './overdue-badge.service';

describe('tareas vencidas en la pestaña', () => {
  const now = new Date(2026, 10, 9, 15, 0);
  const task = (
    dueDate: string | null,
    dueAt: string | null = null,
    completedAt: string | null = null,
  ) => ({ dueDate, dueAt, completedAt });

  it('cuenta solo las vencidas sin hacer', () => {
    const tasks = [
      task('2026-11-08'),
      task('2026-11-09', new Date(2026, 10, 9, 9, 0).toISOString()),
      task('2026-11-09'),
      task('2026-11-01', null, '2026-11-02T10:00:00Z'),
      task(null),
      task('2026-11-20'),
    ];
    expect(countOverdue(tasks, now)).toBe(2);
  });

  it('pone el número delante del nombre de la app', () => {
    expect(titleWith(3)).toBe('(3) Our House');
    expect(titleWith(0)).toBe('Our House');
  });
});
