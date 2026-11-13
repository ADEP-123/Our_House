import { practiceNextDate } from './practice-lists.store';

describe('fechas de la práctica', () => {
  it('pasa a la siguiente vez como el servidor', () => {
    expect(practiceNextDate({ freq: 'weekly', interval: 1, from: 'schedule' }, '2026-11-12')).toBe(
      '2026-11-19',
    );
    expect(
      practiceNextDate(
        { freq: 'weekly', interval: 1, weekdays: [1, 4], from: 'schedule' },
        '2026-11-12',
      ),
    ).toBe('2026-11-16');
    expect(practiceNextDate({ freq: 'monthly', interval: 1, from: 'schedule' }, '2026-01-31')).toBe(
      '2026-02-28',
    );
    expect(practiceNextDate({ freq: 'daily', interval: 3, from: 'schedule' }, '2026-11-12')).toBe(
      '2026-11-15',
    );
  });
});
