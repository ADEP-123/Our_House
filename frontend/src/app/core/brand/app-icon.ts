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
}

/** Trazos del dibujo en un lienzo de 512 × 512 */
const DRAWING = [
  // Techo
  '<path d="M104 241 256 113l152 128"/>',
  // O
  '<circle cx="185" cy="353" r="46"/>',
  // H
  '<path d="M293 307v92M373 307v92M293 353h80"/>',
].join('');

export function appIconSvg({ background, foreground, maskable = false }: AppIconOptions): string {
  const shape = maskable
    ? `<rect width="512" height="512" fill="${background}"/>`
    : `<rect width="512" height="512" rx="112" fill="${background}"/>`;
  // La zona segura de un ícono maskable es el círculo central del 80 %: el dibujo se achica un poco
  const transform = maskable ? ' transform="translate(51.2 51.2) scale(.8)"' : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${shape}` +
    `<g${transform} fill="none" stroke="${foreground}" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">${DRAWING}</g></svg>`
  );
}

/** Para usar como href de un <link rel="icon"> */
export const appIconDataUrl = (options: AppIconOptions) =>
  `data:image/svg+xml,${encodeURIComponent(appIconSvg(options))}`;
