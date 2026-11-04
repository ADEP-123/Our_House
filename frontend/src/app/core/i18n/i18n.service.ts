import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { en } from './en';
import { es } from './es';

export type Locale = 'es' | 'en';

type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };
export type Dictionary = DeepStrings<typeof es>;

/** Todas las claves válidas, ej. 'auth.login.title'. Un error de tipeo no compila. */
type Path<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Path<T[K]>}`;
}[keyof T & string];
export type TranslationKey = Path<Dictionary>;

const DICTIONARIES: Record<Locale, Dictionary> = { es, en };
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
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly document = inject(DOCUMENT);
  private readonly current = signal<Locale>(initialLocale());

  readonly locale = this.current.asReadonly();
  private readonly dictionary = computed(() => DICTIONARIES[this.current()]);

  constructor() {
    this.document.documentElement.lang = this.current();
  }

  setLocale(locale: Locale): void {
    this.current.set(locale);
    this.document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // sin almacenamiento: el idioma vale solo para esta visita
    }
  }

  /** Traduce una clave y reemplaza {parametros}. */
  t(key: TranslationKey, params?: Record<string, string | number>): string {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], this.dictionary());
    const text = typeof value === 'string' ? value : key;
    return params ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : text;
  }

  /** Traduce un código de error de la API; si no existe, usa el genérico. */
  error(code: string | undefined): string {
    const errors = this.dictionary().errors as Record<string, string>;
    return (code && errors[code]) || errors['INTERNAL']!;
  }
}
