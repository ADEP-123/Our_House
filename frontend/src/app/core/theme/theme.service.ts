import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { appIconDataUrl, Festivity } from '../brand/app-icon';
import { patternCss, resolvePattern, THEME_PATTERNS } from './patterns';
import { effectiveTheme, seasonFor } from './seasons';
import { COLOR_TOKENS, CSS_VARS, DEFAULT_THEME, FESTIVITIES, isDark, seasonalBase, Theme, ThemeColors } from './themes';

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
  /** Lo que eligió la persona (en modo automático, lo que se ve cambia con la fecha) */
  private chosen: Theme = DEFAULT_THEME;
  /** Patrón de la temporada para el panel de la marca en la pantalla de inicio de sesión */
  readonly brandPattern = signal('none');

  constructor() {
    this.apply(this.cached() ?? DEFAULT_THEME);
    effect(() => {
      const user = this.auth.user();
      if (user === undefined) return; // aún cargando
      const theme = user?.theme ?? DEFAULT_THEME;
      this.apply(theme);
      this.cache(user ? theme : null);
    });
    // La temporada cambia con la fecha: se revisa al volver a la app y cada hora
    const recheck = () => this.apply(this.chosen);
    this.document.addEventListener('visibilitychange', () => this.document.visibilityState === 'visible' && recheck());
    setInterval(recheck, 60 * 60_000);
  }

  apply(chosen: Theme): void {
    this.chosen = chosen;
    const now = new Date();
    const theme = effectiveTheme(chosen, now);
    const root = this.document.documentElement;
    for (const token of COLOR_TOKENS) root.style.setProperty(CSS_VARS[token], theme.colors[token]);
    root.style.colorScheme = isDark(theme.colors) ? 'dark' : 'light';
    root.style.setProperty('--oh-pattern', ThemeService.patternOf(theme));
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.primary);
    // El ícono de la pestaña toma el color principal de la paleta y, mientras dura una fiesta, su detalle
    const season = seasonFor(now, chosen.auto?.hemisphere ?? 'north');
    const festivity = (FESTIVITIES as readonly string[]).includes(season) ? (season as Festivity) : null;
    this.document
      .querySelector('link[rel="icon"][type="image/svg+xml"]')
      ?.setAttribute('href', appIconDataUrl({ background: theme.colors.primary, foreground: theme.colors.onPrimary, decoration: festivity }));
    // Panel de la marca (inicio de sesión): el patrón de la temporada en el color del texto sobre el principal
    const ink = theme.colors.onPrimary;
    this.brandPattern.set(patternCss({ id: THEME_PATTERNS[season] }, { ...theme.colors, primary: ink, secondary: ink }, 'soft', true));
  }

  /** Patrón de fondo del tema (valor de background-image); en modo automático, el de la temporada de hoy */
  static patternOf(chosen: Theme, now = new Date()): string {
    const theme = effectiveTheme(chosen, now);
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
