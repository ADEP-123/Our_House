import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18n, TranslationKey } from './i18n.service';

/** {{ 'auth.login.title' | t }} — impuro para que se actualice al cambiar el idioma. */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
