import { PATTERN_IDS, patternCss, patternSvg, resolvePattern, samePattern } from './patterns';
import { PRESETS } from './themes';

describe('patrones de fondo', () => {
  it('el del tema solo existe en los temas de temporada; se puede quitar o elegir otro', () => {
    expect(resolvePattern(undefined, 'navidad')).toEqual({ id: 'christmas' });
    expect(resolvePattern(undefined, null)).toBeNull();
    expect(resolvePattern({ id: 'none', intensity: 'soft' }, 'navidad')).toBeNull();
    expect(resolvePattern({ id: 'hearts', intensity: 'soft' }, null)).toEqual({ id: 'hearts' });
    expect(resolvePattern({ id: 'emoji', emoji: '🐶', intensity: 'soft' }, 'otono')).toEqual({
      emoji: '🐶',
    });
  });

  it('dibuja cada patrón con los colores del tema y más visible según la intensidad', () => {
    const colors = PRESETS.invierno;
    for (const id of PATTERN_IDS)
      expect(patternSvg({ id }, colors, 'soft', false)).toContain(colors.primary);
    const opacity = (svg: string) => Number(svg.match(/opacity="([\d.]+)"/)![1]);
    expect(opacity(patternSvg({ id: 'snow' }, colors, 'strong', false))).toBeGreaterThan(
      opacity(patternSvg({ id: 'snow' }, colors, 'soft', false)),
    );
    expect(patternCss(null, colors, 'soft', false)).toBe('none');
    expect(patternCss({ emoji: '🐶' }, colors, 'soft', false)).toMatch(
      /^url\("data:image\/svg\+xml,/,
    );
  });

  it('compara la elección completa, con la de por defecto si no hay', () => {
    expect(samePattern(undefined, { id: 'theme', intensity: 'soft' })).toBe(true);
    expect(
      samePattern(
        { id: 'emoji', emoji: '🐶', intensity: 'soft' },
        { id: 'emoji', emoji: '🐱', intensity: 'soft' },
      ),
    ).toBe(false);
    expect(
      samePattern({ id: 'snow', intensity: 'soft' }, { id: 'snow', intensity: 'strong' }),
    ).toBe(false);
  });
});
