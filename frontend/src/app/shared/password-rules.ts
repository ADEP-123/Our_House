import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { TranslationKey } from '../core/i18n/i18n.service';

/** Mismas reglas que valida la API (backend/src/lib/password.ts). */
export const PASSWORD_RULES: { key: TranslationKey; test: (value: string) => boolean }[] = [
  { key: 'auth.rules.length', test: (v) => v.length >= 10 },
  { key: 'auth.rules.letter', test: (v) => /\p{L}/u.test(v) },
  { key: 'auth.rules.number', test: (v) => /\p{N}/u.test(v) },
];

export const passwordValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  PASSWORD_RULES.every((rule) => rule.test(String(control.value ?? ''))) ? null : { passwordRules: true };

/** Para el grupo del formulario: confirma que ambas contraseñas coinciden. */
export const passwordsMatch =
  (passwordKey: string, confirmKey: string): ValidatorFn =>
  (group: AbstractControl): ValidationErrors | null =>
    group.get(passwordKey)?.value === group.get(confirmKey)?.value ? null : { mismatch: true };
