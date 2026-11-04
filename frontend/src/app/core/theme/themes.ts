import type { TranslationKey } from '../i18n/i18n.service';

export const COLOR_TOKENS = ['primary', 'onPrimary', 'secondary', 'background', 'surface', 'text', 'success', 'error'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeColors = Record<ColorToken, string>;
export type PresetId = 'claro' | 'oscuro' | 'bosque' | 'oceano' | 'lavanda';

export interface Theme {
  preset: PresetId | 'custom';
  colors: ThemeColors;
}

/** Variable CSS de cada color (ver styles.scss) */
export const CSS_VARS: Record<ColorToken, string> = {
  primary: '--oh-primary',
  onPrimary: '--oh-on-primary',
  secondary: '--oh-secondary',
  background: '--oh-background',
  surface: '--oh-surface',
  text: '--oh-text',
  success: '--oh-success',
  error: '--oh-error',
};

export const PRESETS: Record<PresetId, ThemeColors> = {
  claro: {
    primary: '#3f5f90', onPrimary: '#ffffff', secondary: '#5e8c6a', background: '#f5f7fa',
    surface: '#ffffff', text: '#1b2230', success: '#2e7d4f', error: '#b3261e',
  },
  oscuro: {
    primary: '#a8c4f0', onPrimary: '#10294d', secondary: '#9fcdab', background: '#111418',
    surface: '#1b1f26', text: '#e4e7ec', success: '#7fd19b', error: '#ffb4ab',
  },
  bosque: {
    primary: '#2f6b4f', onPrimary: '#ffffff', secondary: '#8a6d3b', background: '#f3f6f2',
    surface: '#ffffff', text: '#1c2620', success: '#2e7d4f', error: '#b3261e',
  },
  oceano: {
    primary: '#006a77', onPrimary: '#ffffff', secondary: '#4a6fa5', background: '#f1f7f8',
    surface: '#ffffff', text: '#13262b', success: '#2e7d4f', error: '#ba1a1a',
  },
  lavanda: {
    primary: '#6750a4', onPrimary: '#ffffff', secondary: '#7d5260', background: '#f7f4fb',
    surface: '#ffffff', text: '#1d1a24', success: '#2e7d4f', error: '#b3261e',
  },
};

export const DEFAULT_THEME: Theme = { preset: 'claro', colors: PRESETS.claro };

/** Compara color por color (el orden de las claves puede cambiar al pasar por la base de datos). */
export const sameTheme = (a: Theme, b: Theme): boolean =>
  a.preset === b.preset && COLOR_TOKENS.every((t) => a.colors[t].toLowerCase() === b.colors[t].toLowerCase());

// ---------- Contraste (WCAG 2.x) ----------

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export const isDark = (colors: ThemeColors): boolean => luminance(colors.background) < 0.2;

/** Combinaciones de texto sobre fondo que la app usa de verdad. 4.5:1 es el mínimo AA para texto normal. */
export const CONTRAST_PAIRS: { fg: ColorToken; bg: ColorToken; label: TranslationKey }[] = [
  { fg: 'onPrimary', bg: 'primary', label: 'appearance.pairs.button' },
  { fg: 'text', bg: 'background', label: 'appearance.pairs.textBackground' },
  { fg: 'text', bg: 'surface', label: 'appearance.pairs.textSurface' },
  { fg: 'primary', bg: 'surface', label: 'appearance.pairs.link' },
  { fg: 'error', bg: 'surface', label: 'appearance.pairs.error' },
  { fg: 'success', bg: 'surface', label: 'appearance.pairs.success' },
];
export const MIN_CONTRAST = 4.5;

export function contrastIssues(colors: ThemeColors) {
  return CONTRAST_PAIRS.map((pair) => ({ ...pair, ratio: contrastRatio(colors[pair.fg], colors[pair.bg]) })).filter(
    (pair) => pair.ratio < MIN_CONTRAST,
  );
}
