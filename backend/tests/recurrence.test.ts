import { describe, expect, it } from 'vitest';
import { finished, nextDate, type RepeatRule } from '../src/lib/recurrence.js';

const rule = (r: Partial<RepeatRule>): RepeatRule => ({
  freq: 'daily',
  interval: 1,
  from: 'schedule',
  start: '2026-11-02',
  ...r,
});

describe('repetición: siguiente fecha', () => {
  it('cada día y cada N días, contados desde el inicio', () => {
    expect(nextDate(rule({}), '2026-11-02')).toBe('2026-11-03');
    expect(nextDate(rule({ interval: 3 }), '2026-11-02')).toBe('2026-11-05');
    // Hecha tarde: sigue el ritmo fijo
    expect(nextDate(rule({ interval: 3 }), '2026-11-06')).toBe('2026-11-08');
  });

  it('cada semana: mismo día del inicio, o los días elegidos; cada 2 semanas respeta el ritmo', () => {
    // 2026-11-02 es lunes
    expect(nextDate(rule({ freq: 'weekly' }), '2026-11-02')).toBe('2026-11-09');
    expect(nextDate(rule({ freq: 'weekly', weekdays: [1, 4] }), '2026-11-02')).toBe('2026-11-05'); // jueves
    expect(nextDate(rule({ freq: 'weekly', weekdays: [1, 4] }), '2026-11-05')).toBe('2026-11-09');
    expect(nextDate(rule({ freq: 'weekly', interval: 2, weekdays: [1, 4] }), '2026-11-05')).toBe('2026-11-16');
    // Hecha el martes siguiente: la próxima vuelve al lunes que toca
    expect(nextDate(rule({ freq: 'weekly' }), '2026-11-10')).toBe('2026-11-16');
  });

  it('cada mes y cada año: mismo día, ajustado al último día cuando no existe', () => {
    expect(nextDate(rule({ freq: 'monthly', start: '2026-01-31' }), '2026-01-31')).toBe('2026-02-28');
    expect(nextDate(rule({ freq: 'monthly', start: '2026-01-31' }), '2026-02-28')).toBe('2026-03-31');
    expect(nextDate(rule({ freq: 'monthly', interval: 3, start: '2026-01-15' }), '2026-01-15')).toBe('2026-04-15');
    expect(nextDate(rule({ freq: 'yearly', start: '2028-02-29' }), '2028-02-29')).toBe('2029-02-28');
    expect(nextDate(rule({ freq: 'yearly', start: '2026-11-02' }), '2026-11-02')).toBe('2027-11-02');
  });

  it('desde que se completó: suma el intervalo al día en que se hizo', () => {
    expect(nextDate(rule({ from: 'completion', interval: 30 }), '2026-11-20')).toBe('2026-12-20');
    expect(nextDate(rule({ freq: 'weekly', from: 'completion' }), '2026-11-20')).toBe('2026-11-27');
    expect(nextDate(rule({ freq: 'monthly', from: 'completion' }), '2026-01-31')).toBe('2026-02-28');
  });

  it('termina en una fecha o después de N veces', () => {
    expect(finished(rule({ until: '2026-11-10' }), '2026-11-11', 1)).toBe(true);
    expect(finished(rule({ until: '2026-11-10' }), '2026-11-10', 1)).toBe(false);
    expect(finished(rule({ count: 3 }), '2026-11-20', 3)).toBe(true);
    expect(finished(rule({ count: 3 }), '2026-11-20', 2)).toBe(false);
  });
});
