import { ICON_GROUPS, isSingleEmoji, searchIcons } from './list-icons';
import { iconOf } from './list-presets';

const names = Object.fromEntries(
  ICON_GROUPS.map((g) => [g.id, g.id === 'health' ? 'Salud' : g.id]),
) as Parameters<typeof searchIcons>[1];

describe('íconos de las listas', () => {
  it('cada ícono del catálogo es un solo emoji', () => {
    for (const g of ICON_GROUPS) for (const i of g.icons) expect(isSingleEmoji(i.emoji)).toBe(true);
    expect(ICON_GROUPS.reduce((n, g) => n + g.icons.length, 0)).toBeGreaterThanOrEqual(50);
  });

  it('busca sin importar tildes ni mayúsculas, también por grupo', () => {
    expect(searchIcons('MEDICO', names).flatMap((g) => g.icons.map((i) => i.emoji))).toEqual([
      '🩺',
    ]);
    expect(searchIcons('salud', names).find((g) => g.id === 'health')!.icons.length).toBe(6);
    expect(searchIcons('zzz', names)).toEqual([]);
    expect(searchIcons('  ', names)).toBe(ICON_GROUPS);
  });

  it('muestra los íconos con nombre, cualquier emoji guardado y, si no, el de siempre', () => {
    expect(iconOf('broom')).toBe('🧹');
    expect(iconOf('🦄')).toBe('🦄');
    expect(iconOf('desconocido')).toBe('✅');
    expect(isSingleEmoji('🦄🦄')).toBe(false);
    expect(isSingleEmoji('hola')).toBe(false);
  });
});
