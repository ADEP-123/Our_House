import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { es } from './es';

export type Locale = 'es' | 'en';

type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };
export type Dictionary = DeepStrings<typeof es>;

/** Todas las claves válidas, ej. 'auth.login.title'. Un error de tipeo no compila. */
type Path<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Path<T[K]>}`;
}[keyof T & string];
export type TranslationKey = Path<Dictionary>;

/**
 * El español va en el paquete inicial; el inglés se descarga aparte solo si alguien lo usa
 * (el service worker lo guarda junto con el resto de la app, así que funciona sin conexión).
 */
const LOADERS: Record<Locale, () => Promise<Dictionary>> = {
  es: () => Promise.resolve(es),
  en: () => import('./en').then((m) => m.en),
};
const STORAGE_KEY = 'oh_locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    // almacenamiento no disponible: se usa el idioma del navegador
  }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/**
 * Traducciones en tiempo de ejecución con signals: cambiar de idioma actualiza
 * la pantalla al instante, sin recargar ni mantener dos builds.
 * Antes de mostrar la app se espera `ready()` (provideAppInitializer en app.config.ts),
 * así quien usa inglés nunca ve la pantalla en español.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly document = inject(DOCUMENT);
  private readonly current = signal<Locale>('es');
  private readonly loaded = signal<Partial<Record<Locale, Dictionary>>>({ es });
  private readonly wanted = initialLocale();

  readonly locale = this.current.asReadonly();
  private readonly dictionary = computed(() => this.loaded()[this.current()] ?? es);

  constructor() {
    this.document.documentElement.lang = this.current();
  }

  /** Carga el idioma con el que arranca la persona (el guardado o el del navegador) */
  ready(): Promise<void> {
    return this.setLocale(this.wanted, false);
  }

  /** Cambia de idioma cuando su diccionario ya está cargado. Sin red y sin la copia del service worker, queda el actual. */
  async setLocale(locale: Locale, remember = true): Promise<void> {
    if (!this.loaded()[locale]) {
      try {
        const dictionary = await LOADERS[locale]();
        this.loaded.update((all) => ({ ...all, [locale]: dictionary }));
      } catch {
        return;
      }
    }
    this.current.set(locale);
    this.document.documentElement.lang = locale;
    if (!remember) return;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // sin almacenamiento: el idioma vale solo para esta visita
    }
  }

  /** Traduce una clave y reemplaza {parametros}. */
  t(key: TranslationKey, params?: Record<string, string | number>): string {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)?.[part],
        this.dictionary(),
      );
    const text = typeof value === 'string' ? value : key;
    return params
      ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
      : text;
  }

  /** Traduce un código de error de la API (con sus datos, ej. {attemptsLeft}); si no existe, usa el genérico. */
  error(code: string | undefined, params?: Record<string, unknown>): string {
    const errors = this.dictionary().errors as Record<string, string>;
    const text = (code && errors[code]) || errors['INTERNAL']!;
    return params
      ? text.replace(/\{(\w+)\}/g, (match, name: string) =>
          params[name] === undefined ? match : String(params[name]),
        )
      : text;
  }
}
