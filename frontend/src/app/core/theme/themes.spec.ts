import { contrastIssues, contrastRatio, PRESETS, sameTheme } from './themes';

describe('temas', () => {
  it('calcula el contraste como WCAG (negro sobre blanco = 21)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('todos los temas predefinidos cumplen el contraste mínimo', () => {
    for (const [name, colors] of Object.entries(PRESETS)) {
      expect({ name, issues: contrastIssues(colors).map((i) => i.label) }).toEqual({ name, issues: [] });
    }
  });

  it('detecta un botón ilegible', () => {
    const issues = contrastIssues({ ...PRESETS.claro, onPrimary: '#4a6a9a' });
    expect(issues.map((i) => i.fg + '/' + i.bg)).toEqual(['onPrimary/primary']);
  });

  it('considera iguales dos paletas con las claves en otro orden', () => {
    const reordered = Object.fromEntries(Object.entries(PRESETS.oscuro).reverse()) as typeof PRESETS.oscuro;
    expect(sameTheme({ preset: 'oscuro', colors: PRESETS.oscuro }, { preset: 'oscuro', colors: reordered })).toBe(true);
    expect(sameTheme({ preset: 'oscuro', colors: PRESETS.oscuro }, { preset: 'claro', colors: PRESETS.claro })).toBe(false);
  });
});
