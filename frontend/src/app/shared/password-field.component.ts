import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TPipe } from '../core/i18n/t.pipe';
import { PASSWORD_RULES } from './password-rules';

let nextId = 0;

/**
 * Campo de contraseña con botón para mostrarla y, opcionalmente,
 * la lista de requisitos que se marca en tiempo real mientras se escribe.
 */
@Component({
  selector: 'oh-password-field',
  imports: [ReactiveFormsModule, TPipe],
  template: `
    <div class="oh-field">
      <label [for]="id">{{ label() }}</label>
      <div class="wrap">
        <input
          class="oh-input"
          [id]="id"
          [type]="visible() ? 'text' : 'password'"
          [formControl]="control()"
          [attr.autocomplete]="autocomplete()"
          [attr.aria-invalid]="invalid() || null"
          [attr.aria-describedby]="showRules() ? id + '-rules' : null"
        />
        <button
          type="button"
          class="toggle"
          (click)="visible.set(!visible())"
          [attr.aria-label]="(visible() ? 'common.hidePassword' : 'common.showPassword') | t"
          [attr.aria-pressed]="visible()"
        >
          @if (visible()) {
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.5 8 3.2 10 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1" /></svg>
          } @else {
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          }
        </button>
      </div>
      @if (showRules()) {
        <ul class="rules" [id]="id + '-rules'">
          @for (rule of rules(); track rule.key) {
            <li [class.met]="rule.met">
              <span class="mark" aria-hidden="true">{{ rule.met ? '✓' : '•' }}</span>
              {{ rule.key | t }}
            </li>
          }
        </ul>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .wrap {
      position: relative;
    }
    .oh-input {
      padding-right: 52px;
    }
    .toggle {
      position: absolute;
      inset: 0 0 0 auto;
      width: 48px;
      display: grid;
      place-items: center;
      background: none;
      border: 0;
      color: var(--oh-text-muted);
      cursor: pointer;
      border-radius: 0 var(--oh-radius-sm) var(--oh-radius-sm) 0;
    }
    svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
    }
    .rules {
      list-style: none;
      margin: 2px 0 0;
      padding: 0;
      display: grid;
      gap: 2px;
      font-size: 0.875rem;
      color: var(--oh-text-muted);
    }
    .rules li {
      display: flex;
      gap: 8px;
    }
    .rules .mark {
      width: 1em;
      text-align: center;
    }
    .rules .met {
      color: var(--oh-success);
      font-weight: 500;
    }
  `,
})
export class PasswordFieldComponent implements OnInit {
  readonly control = input.required<FormControl<string>>();
  readonly label = input.required<string>();
  readonly autocomplete = input('current-password');
  readonly showRules = input(false);
  readonly invalid = input(false);

  protected readonly id = `oh-password-${nextId++}`;
  protected readonly visible = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly value = signal('');
  protected readonly rules = computed(() =>
    PASSWORD_RULES.map((rule) => ({ key: rule.key, met: rule.test(this.value()) })),
  );

  ngOnInit(): void {
    const control = this.control();
    this.value.set(control.value ?? '');
    control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.value.set(v ?? ''));
  }
}
