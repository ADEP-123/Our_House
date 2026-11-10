/**
 * Ícono de la app: el techo de la casa sobre las letras "OH".
 * El mismo dibujo sirve para los archivos de la app instalada (con el color de siempre)
 * y para el ícono de la pestaña, que toma el color principal de la paleta de cada persona.
 */
export interface AppIconOptions {
  /** Fondo (color principal) */
  background: string;
  /** Techo y letras (color sobre el principal) */
  foreground: string;
  /**
   * maskable: fondo a sangre y el dibujo dentro de la zona segura (Android recorta el ícono a su forma);
   * si no, cuadrado con esquinas redondeadas.
   */
  maskable?: boolean;
  /** Detalle de fiesta (solo en la pestaña): gorro, calabaza, corazón o estrella */
  decoration?: Festivity | null;
}

export type Festivity = 'navidad' | 'halloween' | 'amor' | 'anionuevo';

/** Detalles de cada fiesta, con colores propios para que se vean sobre cualquier color principal */
const DECORATIONS: Record<Festivity, string> = {
  // Gorro sobre la punta del techo
  navidad:
    '<path d="M196 132C206 74 262 40 330 58L350 104 316 92C306 108 300 120 298 132Z" fill="#d62839" stroke="#ffffff" stroke-width="8" stroke-linejoin="round"/>' +
    '<rect x="186" y="118" width="128" height="34" rx="17" fill="#ffffff"/><circle cx="352" cy="102" r="22" fill="#ffffff"/>',
  // Calabaza en la esquina
  halloween:
    '<g transform="translate(402 112)"><g stroke="#ffffff" stroke-width="16"><ellipse cx="-26" rx="30" ry="40"/><ellipse cx="26" rx="30" ry="40"/><ellipse rx="30" ry="42"/></g>' +
    '<ellipse cx="-26" rx="30" ry="40" fill="#e8710a"/><ellipse cx="26" rx="30" ry="40" fill="#e8710a"/>' +
    '<ellipse rx="30" ry="42" fill="#f68b1f"/><path d="M0 -40C0 -54 6 -62 16 -66" fill="none" stroke="#3f7d20" stroke-width="12" stroke-linecap="round"/></g>',
  amor: '<path d="M404 168C352 136 338 104 352 80S396 62 404 86C412 62 442 56 456 80S456 136 404 168Z" fill="#ff4d79" stroke="#ffffff" stroke-width="10" stroke-linejoin="round"/>',
  anionuevo:
    '<path d="M404 42 420 84 464 86 430 114 442 158 404 132 366 158 378 114 344 86 388 84Z" fill="#ffd23f" stroke="#ffffff" stroke-width="8" stroke-linejoin="round"/>',
};

/** Trazos del dibujo en un lienzo de 512 × 512 */
const DRAWING = [
  // Techo
  '<path d="M104 241 256 113l152 128"/>',
  // O
  '<circle cx="185" cy="353" r="46"/>',
  // H
  '<path d="M293 307v92M373 307v92M293 353h80"/>',
].join('');

export function appIconSvg({
  background,
  foreground,
  maskable = false,
  decoration = null,
}: AppIconOptions): string {
  const shape = maskable
    ? `<rect width="512" height="512" fill="${background}"/>`
    : `<rect width="512" height="512" rx="112" fill="${background}"/>`;
  // La zona segura de un ícono maskable es el círculo central del 80 %: el dibujo se achica un poco
  const transform = maskable ? ' transform="translate(51.2 51.2) scale(.8)"' : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${shape}` +
    `<g${transform} fill="none" stroke="${foreground}" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">${DRAWING}</g>` +
    (decoration && !maskable ? DECORATIONS[decoration] : '') +
    '</svg>'
  );
}

/** Para usar como href de un <link rel="icon"> */
export const appIconDataUrl = (options: AppIconOptions) =>
  `data:image/svg+xml,${encodeURIComponent(appIconSvg(options))}`;
