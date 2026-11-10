import type { TranslationKey } from '../i18n/i18n.service';
import { samePattern, type PatternSetting } from './patterns';

export const COLOR_TOKENS = ['primary', 'onPrimary', 'secondary', 'background', 'surface', 'text', 'success', 'error'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeColors = Record<ColorToken, string>;
export const CLASSIC_PRESETS = ['claro', 'oscuro', 'bosque', 'oceano', 'lavanda'] as const;
/** Temas de temporada: las cuatro estaciones y las fiestas, cada uno en versión clara y oscura */
export const SEASONS = ['primavera', 'verano', 'otono', 'invierno'] as const;
export const FESTIVITIES = ['navidad', 'halloween', 'amor', 'anionuevo'] as const;
export type ClassicId = (typeof CLASSIC_PRESETS)[number];
export type SeasonalId = (typeof SEASONS)[number] | (typeof FESTIVITIES)[number];
export type PresetId = ClassicId | SeasonalId | `${SeasonalId}-oscuro`;

/** Tema de temporada en su versión clara u oscura */
export const seasonalPreset = (id: SeasonalId, dark: boolean): PresetId => (dark ? `${id}-oscuro` : id);
/** "navidad-oscuro" → "navidad"; los clásicos no son de temporada */
export function seasonalBase(preset: string): SeasonalId | null {
  const base = preset.replace(/-oscuro$/, '');
  return ([...SEASONS, ...FESTIVITIES] as string[]).includes(base) ? (base as SeasonalId) : null;
}
export const isDarkVariant = (preset: string) => preset.endsWith('-oscuro');

export type Hemisphere = 'north' | 'south';

/** Modo automático: el tema cambia solo según la estación o la fiesta del día (ver seasons.ts) */
export interface AutoSetting {
  enabled: boolean;
  hemisphere: Hemisphere;
  /** Versión oscura de cada tema */
  dark: boolean;
}

export const DEFAULT_AUTO: AutoSetting = { enabled: false, hemisphere: 'north', dark: false };

export const sameAuto = (a: AutoSetting | undefined, b: AutoSetting | undefined): boolean => {
  const x = a ?? DEFAULT_AUTO;
  const y = b ?? DEFAULT_AUTO;
  return x.enabled === y.enabled && (!x.enabled || (x.hemisphere === y.hemisphere && x.dark === y.dark));
};

export interface Theme {
  preset: PresetId | 'custom';
  colors: ThemeColors;
  /** Patrón de fondo (sin dato: el del tema, suave) */
  pattern?: PatternSetting;
  /** Modo automático por temporada (sin dato: apagado) */
  auto?: AutoSetting;
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
  // ---------- Temporadas (claro) ----------
  primavera: {
    primary: '#9c3567', onPrimary: '#ffffff', secondary: '#4f8a3c', background: '#fbf6f8',
    surface: '#ffffff', text: '#2a1d24', success: '#2e7d4f', error: '#b3261e',
  },
  verano: {
    primary: '#0b6680', onPrimary: '#ffffff', secondary: '#b07800', background: '#fffaf0',
    surface: '#ffffff', text: '#1f2a30', success: '#2e7d4f', error: '#b3261e',
  },
  otono: {
    primary: '#9a4510', onPrimary: '#ffffff', secondary: '#7a5c2e', background: '#faf4ec',
    surface: '#fffdf9', text: '#2b2018', success: '#3a7a37', error: '#b3261e',
  },
  invierno: {
    primary: '#34579a', onPrimary: '#ffffff', secondary: '#4f86a8', background: '#f1f5fa',
    surface: '#ffffff', text: '#17212e', success: '#2e7d4f', error: '#b3261e',
  },
  navidad: {
    primary: '#ad222b', onPrimary: '#ffffff', secondary: '#1f6b3d', background: '#f8f3ea',
    surface: '#fffdf8', text: '#231a17', success: '#1f6b3d', error: '#8f1d14',
  },
  halloween: {
    primary: '#a84400', onPrimary: '#ffffff', secondary: '#5b3b8c', background: '#fbf4ec',
    surface: '#ffffff', text: '#221a24', success: '#2e7d4f', error: '#b3261e',
  },
  amor: {
    primary: '#ad2457', onPrimary: '#ffffff', secondary: '#c4547a', background: '#fdf3f6',
    surface: '#ffffff', text: '#2a1a20', success: '#2e7d4f', error: '#a8231b',
  },
  anionuevo: {
    primary: '#7a5d00', onPrimary: '#ffffff', secondary: '#2e3f78', background: '#faf7ee',
    surface: '#ffffff', text: '#1c1d26', success: '#2e7d4f', error: '#b3261e',
  },
  // ---------- Temporadas (oscuro) ----------
  'primavera-oscuro': {
    primary: '#f2a5c6', onPrimary: '#4a1230', secondary: '#9fd08a', background: '#1a1418',
    surface: '#251c22', text: '#f1e6ec', success: '#8fd6a3', error: '#ffb4ab',
  },
  'verano-oscuro': {
    primary: '#7fd3e6', onPrimary: '#00363f', secondary: '#f2c55c', background: '#0f1a1e',
    surface: '#17252a', text: '#e3eff2', success: '#8fd6a3', error: '#ffb4ab',
  },
  'otono-oscuro': {
    primary: '#f0a46a', onPrimary: '#4a1f00', secondary: '#d9b77e', background: '#1a1511',
    surface: '#251e18', text: '#f2e8de', success: '#8fd6a3', error: '#ffb4ab',
  },
  'invierno-oscuro': {
    primary: '#a9c8f5', onPrimary: '#0f2a4f', secondary: '#9cc6df', background: '#0f141c',
    surface: '#18202b', text: '#e5ecf5', success: '#8fd6a3', error: '#ffb4ab',
  },
  'navidad-oscuro': {
    primary: '#f2a0a0', onPrimary: '#5c0d12', secondary: '#8fd3a6', background: '#0f1a14',
    surface: '#17261d', text: '#f0ebe1', success: '#8fd6a3', error: '#ffb4ab',
  },
  'halloween-oscuro': {
    primary: '#ffa552', onPrimary: '#3d1a00', secondary: '#c3a6f0', background: '#16111d',
    surface: '#211a2b', text: '#efe6f5', success: '#8fd6a3', error: '#ffb4ab',
  },
  'amor-oscuro': {
    primary: '#ff9cba', onPrimary: '#4d0a24', secondary: '#f0b3c6', background: '#1c1116',
    surface: '#281920', text: '#f6e6ec', success: '#8fd6a3', error: '#ffb4ab',
  },
  'anionuevo-oscuro': {
    primary: '#f0cd6a', onPrimary: '#3a2c00', secondary: '#a9b8f0', background: '#0e1022',
    surface: '#181b33', text: '#ecebf5', success: '#8fd6a3', error: '#ffb4ab',
  },
};

export const DEFAULT_THEME: Theme = { preset: 'claro', colors: PRESETS.claro };

/** Compara color por color (el orden de las claves puede cambiar al pasar por la base de datos). */
export const sameTheme = (a: Theme, b: Theme): boolean =>
  a.preset === b.preset &&
  COLOR_TOKENS.every((t) => a.colors[t].toLowerCase() === b.colors[t].toLowerCase()) &&
  samePattern(a.pattern, b.pattern) &&
  sameAuto(a.auto, b.auto);

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
