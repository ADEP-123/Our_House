import type { SeasonalId, ThemeColors } from './themes';

/**
 * Patrones de fondo: dibujos pequeños que se repiten detrás del contenido (nunca sobre las tarjetas).
 * Se dibujan en código como SVG con los colores de la paleta, así funcionan sin conexión
 * y se ven bien en temas claros y oscuros.
 */
export const PATTERN_IDS = [
  'flowers',
  'sun',
  'leaves',
  'snow',
  'christmas',
  'halloween',
  'hearts',
  'confetti',
  'stars',
  'dots',
] as const;
export type PatternId = (typeof PATTERN_IDS)[number];
export const PATTERN_INTENSITIES = ['soft', 'medium', 'strong'] as const;
export type PatternIntensity = (typeof PATTERN_INTENSITIES)[number];

/** Lo que elige cada persona: el patrón de su tema, ninguno, uno de la lista o un emoji propio */
export interface PatternSetting {
  id: 'theme' | 'none' | 'emoji' | PatternId;
  emoji?: string;
  intensity: PatternIntensity;
}

export const DEFAULT_PATTERN: PatternSetting = { id: 'theme', intensity: 'soft' };

/** El patrón que trae cada tema de temporada */
export const THEME_PATTERNS: Record<SeasonalId, PatternId> = {
  primavera: 'flowers',
  verano: 'sun',
  otono: 'leaves',
  invierno: 'snow',
  navidad: 'christmas',
  halloween: 'halloween',
  amor: 'hearts',
  anionuevo: 'confetti',
};

/** Patrón concreto a dibujar */
export type ResolvedPattern = { id: PatternId } | { emoji: string };

export function resolvePattern(
  setting: PatternSetting | undefined,
  seasonal: SeasonalId | null,
): ResolvedPattern | null {
  const s = setting ?? DEFAULT_PATTERN;
  if (s.id === 'none') return null;
  if (s.id === 'emoji') return s.emoji ? { emoji: s.emoji } : null;
  if (s.id === 'theme') return seasonal ? { id: THEME_PATTERNS[seasonal] } : null;
  return { id: s.id };
}

export const samePattern = (
  a: PatternSetting | undefined,
  b: PatternSetting | undefined,
): boolean => {
  const x = a ?? DEFAULT_PATTERN;
  const y = b ?? DEFAULT_PATTERN;
  return x.id === y.id && x.intensity === y.intensity && (x.id !== 'emoji' || x.emoji === y.emoji);
};

// ---------- Dibujo ----------

const TILE = 160;

/** Qué tanto se nota: más en temas oscuros, donde los colores claros se pierden menos */
const ALPHA: Record<PatternIntensity, [light: number, dark: number]> = {
  soft: [0.11, 0.13],
  medium: [0.18, 0.21],
  strong: [0.28, 0.32],
};

/**
 * Figuras en unidades alrededor de (0, 0), de radio ~10. "a" es el color principal y "b" el secundario.
 * Cada patrón tiene una figura grande y otra chica para que el fondo no se vea como una grilla.
 */
type Motif = (a: string, b: string) => string;

const snowflake: Motif = (a) => {
  const arm = (deg: number) =>
    `<g transform="rotate(${deg})"><path d="M0 -10V10M-3 -7.5 0 -5 3 -7.5M-3 7.5 0 5 3 7.5"/></g>`;
  return `<g fill="none" stroke="${a}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${[0, 60, 120].map(arm).join('')}</g>`;
};
const flower: Motif = (a, b) =>
  [0, 72, 144, 216, 288]
    .map((deg) => `<ellipse rx="3.6" ry="6" cy="-6" transform="rotate(${deg})" fill="${a}"/>`)
    .join('') + `<circle r="3.4" fill="${b}"/>`;
const leaf: Motif = (a) =>
  `<path d="M0 -11C7 -6 7 5 0 11C-7 5 -7 -6 0 -11Z" fill="${a}"/><path d="M0 -8V13" stroke="${a}" stroke-width="1.2" stroke-linecap="round"/>`;
const sun: Motif = (a) =>
  `<circle r="5" fill="${a}"/><g stroke="${a}" stroke-width="1.6" stroke-linecap="round">${[
    0, 45, 90, 135, 180, 225, 270, 315,
  ]
    .map((deg) => `<path d="M0 -8V-11" transform="rotate(${deg})"/>`)
    .join('')}</g>`;
const wave: Motif = (_a, b) =>
  `<path d="M-12 0C-9 -4 -6 -4 -3 0S3 4 6 0 9 -4 12 0" fill="none" stroke="${b}" stroke-width="1.8" stroke-linecap="round"/>`;
const tree: Motif = (a, b) =>
  `<path d="M0 -11 6 -3H3L8 4H-8L-3 -3H-6Z" fill="${a}"/><rect x="-1.5" y="4" width="3" height="4" fill="${a}"/>` +
  `<circle cx="-2" cy="-1" r="1" fill="${b}"/><circle cx="2.5" cy="1.5" r="1" fill="${b}"/>`;
const star: Motif = (a) =>
  `<path d="M0 -10 2.9 -3.6 9.5 -3.1 4.5 1.3 6 7.9 0 4.4 -6 7.9 -4.5 1.3 -9.5 -3.1 -2.9 -3.6Z" fill="${a}"/>`;
const pumpkin: Motif = (a, b) =>
  `<ellipse rx="5" ry="7" cx="-4" fill="${a}"/><ellipse rx="5" ry="7" cx="4" fill="${a}"/><ellipse rx="5" ry="7.5" fill="${a}"/>` +
  `<path d="M0 -7.5C0 -10 1 -11 3 -11.5" fill="none" stroke="${b}" stroke-width="1.6" stroke-linecap="round"/>`;
const bat: Motif = (_a, b) =>
  `<path d="M0 -2C-1.5 -4.5 -1.5 -4.5 -2 -2C-6 -5 -10 -3 -12 1C-9 0 -8 2 -7 3C-5 1 -3 2 -2 3H2C3 2 5 1 7 3C8 2 9 0 12 1C10 -3 6 -5 2 -2C1.5 -4.5 1.5 -4.5 0 -2Z" fill="${b}"/>`;
const heart: Motif = (a) =>
  `<path d="M0 9C-9 3 -11 -3 -8 -7S-1 -9 0 -4C1 -9 5 -10 8 -7S9 3 0 9Z" fill="${a}"/>`;
const confetti: Motif = (a, b) =>
  `<rect x="-6" y="-8" width="3" height="7" rx="1" transform="rotate(-25)" fill="${a}"/>` +
  `<rect x="3" y="-3" width="3" height="7" rx="1" transform="rotate(30)" fill="${b}"/>` +
  `<circle cx="-4" cy="6" r="1.8" fill="${b}"/><circle cx="6" cy="-7" r="1.5" fill="${a}"/>`;
const sparkle: Motif = (a) =>
  `<path d="M0 -8C1 -2 2 -1 8 0C2 1 1 2 0 8C-1 2 -2 1 -8 0C-2 -1 -1 -2 0 -8Z" fill="${a}"/>`;
const dot: Motif = (a) => `<circle r="5" fill="${a}"/>`;

/** [figura grande, figura chica] de cada patrón */
const MOTIFS: Record<PatternId, [Motif, Motif]> = {
  flowers: [flower, leaf],
  sun: [sun, wave],
  leaves: [leaf, (a, b) => leaf(b, a)],
  snow: [snowflake, (a) => `<circle r="2.5" fill="${a}"/>`],
  christmas: [tree, snowflake],
  halloween: [pumpkin, bat],
  hearts: [heart, (_a, b) => heart(b, b)],
  confetti: [confetti, sparkle],
  stars: [star, sparkle],
  dots: [dot, (_a, b) => dot(b, b)],
};

/** Dónde va cada figura dentro del mosaico: [x, y, escala, giro, grande o chica] */
const SPOTS: [number, number, number, number, 0 | 1][] = [
  [38, 40, 1.7, -14, 0],
  [118, 112, 1.5, 18, 0],
  [116, 34, 1, 28, 1],
  [36, 122, 1.1, -24, 1],
  [80, 80, 0.7, 8, 1],
];

const place = (x: number, y: number, scale: number, rotate: number, body: string) =>
  `<g transform="translate(${x} ${y}) rotate(${rotate}) scale(${scale})">${body}</g>`;

export function patternSvg(
  pattern: ResolvedPattern,
  colors: ThemeColors,
  intensity: PatternIntensity,
  dark: boolean,
): string {
  const alpha = ALPHA[intensity][dark ? 1 : 0];
  let body: string;
  if ('emoji' in pattern) {
    // Un emoji tiene sus propios colores: se muestra más transparente y en dos tamaños
    const text = (x: number, y: number, size: number, rotate: number) =>
      `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" transform="rotate(${rotate} ${x} ${y})">${pattern.emoji}</text>`;
    body = `<g opacity="${Math.min(1, alpha * 1.5).toFixed(2)}">${text(40, 42, 30, -12)}${text(118, 114, 26, 14)}${text(112, 34, 16, 20)}${text(38, 122, 18, -18)}</g>`;
  } else {
    const [big, small] = MOTIFS[pattern.id];
    body =
      `<g opacity="${alpha}">` +
      SPOTS.map(([x, y, scale, rotate, kind]) =>
        place(x, y, scale, rotate, (kind ? small : big)(colors.primary, colors.secondary)),
      ).join('') +
      '</g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">${body}</svg>`;
}

/** Valor para background-image (o "none") */
export function patternCss(
  pattern: ResolvedPattern | null,
  colors: ThemeColors,
  intensity: PatternIntensity,
  dark: boolean,
): string {
  if (!pattern) return 'none';
  return `url("data:image/svg+xml,${encodeURIComponent(patternSvg(pattern, colors, intensity, dark))}")`;
}
