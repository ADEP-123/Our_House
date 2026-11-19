import { TestBed } from '@angular/core/testing';
import { en } from './en';
import { es } from './es';
import { I18n } from './i18n.service';

const keys = (node: object, prefix = ''): string[] =>
  Object.entries(node).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`),
  );

describe('I18n', () => {
  beforeEach(() => localStorage.clear());

  it('español e inglés tienen exactamente las mismas claves', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });

  it('traduce con parámetros y cambia de idioma al instante', async () => {
    const i18n = TestBed.inject(I18n);
    await i18n.setLocale('es');
    expect(i18n.t('home.greeting', { name: 'Ana' })).toBe('Hola, Ana');
    await i18n.setLocale('en');
    expect(i18n.t('home.greeting', { name: 'Ana' })).toBe('Hi, Ana');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('oh_locale')).toBe('en');
  });

  it('arranca en español y carga el inglés guardado antes de mostrar la app', async () => {
    localStorage.setItem('oh_locale', 'en');
    const i18n = TestBed.inject(I18n);
    expect(i18n.locale()).toBe('es');
    await i18n.ready();
    expect(i18n.locale()).toBe('en');
    expect(i18n.t('common.language')).toBe('Language');
  });

  it('usa un mensaje genérico para códigos de error desconocidos', async () => {
    const i18n = TestBed.inject(I18n);
    await i18n.setLocale('es');
    expect(i18n.error('NICKNAME_TAKEN')).toBe('Ese apodo ya está en uso');
    expect(i18n.error('CODIGO_QUE_NO_EXISTE')).toBe(es.errors.INTERNAL);
  });
});
