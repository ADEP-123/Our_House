import { DOCUMENT, Injectable, effect, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { appIconDataUrl } from '../brand/app-icon';
import { patternCss, resolvePattern } from './patterns';
import { COLOR_TOKENS, CSS_VARS, DEFAULT_THEME, isDark, seasonalBase, Theme, ThemeColors } from './themes';

const STORAGE_KEY = 'oh_theme';

/**
 * Aplica la paleta del usuario como variables CSS en <html>.
 * Se guarda una copia local para pintar los colores correctos desde el primer instante,
 * antes de que responda la API.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);

  constructor() {
    this.apply(this.cached() ?? DEFAULT_THEME);
    effect(() => {
      const user = this.auth.user();
      if (user === undefined) return; // aún cargando
      const theme = user?.theme ?? DEFAULT_THEME;
      this.apply(theme);
      this.cache(user ? theme : null);
    });
  }

  apply(theme: Theme): void {
    const root = this.document.documentElement;
    for (const token of COLOR_TOKENS) root.style.setProperty(CSS_VARS[token], theme.colors[token]);
    root.style.colorScheme = isDark(theme.colors) ? 'dark' : 'light';
    root.style.setProperty('--oh-pattern', ThemeService.patternOf(theme));
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.primary);
    // El ícono de la pestaña toma el color principal de la paleta
    this.document
      .querySelector('link[rel="icon"][type="image/svg+xml"]')
      ?.setAttribute('href', appIconDataUrl({ background: theme.colors.primary, foreground: theme.colors.onPrimary }));
  }

  /** Patrón de fondo del tema (valor de background-image) */
  static patternOf(theme: Theme): string {
    const pattern = resolvePattern(theme.pattern, seasonalBase(theme.preset));
    return patternCss(pattern, theme.colors, theme.pattern?.intensity ?? 'soft', isDark(theme.colors));
  }

  /** Estilo en línea para pintar una vista previa con otros colores sin tocar el resto de la app. */
  static previewStyle(colors: ThemeColors): Record<string, string> {
    return Object.fromEntries(COLOR_TOKENS.map((token) => [CSS_VARS[token], colors[token]]));
  }

  private cached(): Theme | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Theme) : null;
    } catch {
      return null;
    }
  }

  private cache(theme: Theme | null): void {
    try {
      if (theme) localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // sin almacenamiento local: se usa el tema de la API en cada visita
    }
  }
}
