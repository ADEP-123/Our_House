import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { I18n } from '../../core/i18n/i18n.service';
import { amountForInput, isExpression, parseAmount } from './movement-logic';

/**
 * Campo de monto que acepta cuentas ("12500+3000-500", "3x20000"): al salir del campo muestra
 * el resultado. Con formularios reactivos entrega el número (o null si está vacío o no es válido).
 */
@Directive({
  selector: 'input[ohAmount]',
  host: {
    '(blur)': 'solve()',
    '(input)': 'changed()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AmountInputDirective),
      multi: true,
    },
  ],
})
export class AmountInputDirective implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly i18n = inject(I18n);
  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  /** Si hay una cuenta que se puede hacer, la reemplaza por el resultado */
  protected solve(): void {
    this.onTouched();
    const text = this.el.value;
    if (!isExpression(text)) return;
    const value = parseAmount(text, this.i18n.locale());
    if (value === null) return;
    this.el.value = amountForInput(value, this.i18n.locale());
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  protected changed(): void {
    this.onChange(this.el.value.trim() ? parseAmount(this.el.value, this.i18n.locale()) : null);
  }

  writeValue(value: number | null | undefined): void {
    this.el.value =
      value === null || value === undefined ? '' : amountForInput(value, this.i18n.locale());
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.el.disabled = disabled;
  }
}
