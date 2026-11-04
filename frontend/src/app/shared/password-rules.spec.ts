import { FormControl, FormGroup } from '@angular/forms';
import { PASSWORD_RULES, passwordValidator, passwordsMatch } from './password-rules';

describe('reglas de contraseña', () => {
  const valid = (value: string) => passwordValidator(new FormControl(value)) === null;

  it('exige 10 caracteres, una letra y un número; símbolos y mayúsculas son opcionales', () => {
    expect(valid('abcdefghi1')).toBe(true);
    expect(valid('abc def-12!')).toBe(true);
    expect(valid('abcdefgh1')).toBe(false); // 9 caracteres
    expect(valid('abcdefghij')).toBe(false); // sin número
    expect(valid('1234567890')).toBe(false); // sin letra
    expect(valid('ñandú-2026x')).toBe(true); // letras con tilde cuentan
  });

  it('marca cada requisito por separado para la lista en tiempo real', () => {
    expect(PASSWORD_RULES.map((r) => r.test('abc1'))).toEqual([false, true, true]);
  });

  it('detecta cuando la confirmación no coincide', () => {
    const group = new FormGroup(
      { password: new FormControl('abcdefghi1'), confirm: new FormControl('abcdefghi2') },
      { validators: passwordsMatch('password', 'confirm') },
    );
    expect(group.hasError('mismatch')).toBe(true);
    group.controls.confirm.setValue('abcdefghi1');
    expect(group.hasError('mismatch')).toBe(false);
  });
});
