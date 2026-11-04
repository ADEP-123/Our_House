import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TPipe } from '../../core/i18n/t.pipe';
import { LIST_COLORS, LIST_ICONS, LIST_TYPES, ListType } from './list-presets';
import { ListInput } from './lists.models';

/** Formulario de crear / editar lista. El tipo solo se elige al crear. */
@Component({
  selector: 'oh-list-form',
  imports: [ReactiveFormsModule, TPipe],
  template: `
    <form class="oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h2>{{ (initial() ? 'lists.form.editTitle' : 'lists.form.createTitle') | t }}</h2>

      <div class="oh-field">
        <label for="list-name">{{ 'lists.form.name' | t }}</label>
        <input id="list-name" class="oh-input" formControlName="name" maxlength="80" [placeholder]="'lists.form.namePlaceholder' | t" />
      </div>

      @if (!initial()) {
        <fieldset>
          <legend>{{ 'lists.form.type' | t }}</legend>
          <div class="segmented">
            @for (type of types; track type.id) {
              <label [class.on]="form.controls.type.value === type.id">
                <input type="radio" class="oh-sr-only" formControlName="type" [value]="type.id" (change)="onType(type.id)" />
                {{ type.label | t }}
              </label>
            }
          </div>
        </fieldset>
      }

      <fieldset>
        <legend>{{ 'lists.form.color' | t }}</legend>
        <div class="swatches">
          @for (c of colors; track c[0]) {
            <label class="swatch" [style.background]="c[1]" [class.on]="form.controls.color.value === c[0]" [title]="c[0]">
              <input type="radio" class="oh-sr-only" formControlName="color" [value]="c[0]" [attr.aria-label]="c[0]" />
            </label>
          }
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ 'lists.form.icon' | t }}</legend>
        <div class="icons">
          @for (i of icons; track i[0]) {
            <label class="icon" [class.on]="form.controls.icon.value === i[0]">
              <input type="radio" class="oh-sr-only" formControlName="icon" [value]="i[0]" [attr.aria-label]="i[0]" />
              <span aria-hidden="true">{{ i[1] }}</span>
            </label>
          }
        </div>
      </fieldset>

      @if (showPrivacy()) {
        <label class="check">
          <input type="checkbox" formControlName="isPrivate" />
          <span>{{ 'lists.form.private' | t }}</span>
        </label>
        @if (form.controls.isPrivate.value && supervised()) {
          <p class="oh-alert" role="note">🔎 {{ 'lists.form.supervisedNotice' | t }}</p>
        }
      }

      @if (error(); as err) {
        <p class="oh-alert is-error" role="alert">{{ err }}</p>
      }

      <div class="actions">
        <button class="oh-btn oh-btn--filled" type="submit" [disabled]="form.invalid || busy()">
          {{ (initial() ? 'lists.form.save' : 'lists.form.create') | t }}
        </button>
        <button class="oh-btn oh-btn--text" type="button" (click)="cancelled.emit()">{{ 'lists.form.cancel' | t }}</button>
      </div>
    </form>
  `,
  styles: `
    h2 {
      font-size: 1.125rem;
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    legend {
      font-weight: 600;
      font-size: 0.9375rem;
      margin-bottom: 8px;
    }
    .segmented {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .segmented label {
      padding: 8px 16px;
      border-radius: 999px;
      border: 1px solid var(--oh-border-strong);
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9375rem;
    }
    .segmented label.on {
      background: var(--oh-primary);
      border-color: var(--oh-primary);
      color: var(--oh-on-primary);
    }
    .swatches,
    .icons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .swatch {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      outline-offset: 3px;
    }
    .swatch.on {
      outline: 3px solid var(--oh-text);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      border: 2px solid transparent;
      background: var(--oh-background);
      font-size: 1.3rem;
      cursor: pointer;
    }
    .icon.on {
      border-color: var(--oh-primary);
    }
    label:has(input:focus-visible) {
      outline: 3px solid var(--oh-focus);
      outline-offset: 2px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      cursor: pointer;
    }
    .check input {
      width: 20px;
      height: 20px;
      accent-color: var(--oh-primary);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
  `,
})
export class ListFormComponent implements OnInit {
  readonly initial = input<(ListInput & { canChangePrivacy: boolean }) | null>(null);
  /** El usuario es miembro supervisado del grupo: se le avisa que los líderes ven sus privadas */
  readonly supervised = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly saved = output<ListInput>();
  readonly cancelled = output<void>();

  protected readonly types = LIST_TYPES;
  protected readonly colors = Object.entries(LIST_COLORS);
  protected readonly icons = Object.entries(LIST_ICONS);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    type: ['todo' as ListType],
    color: ['blue'],
    icon: ['check'],
    isPrivate: [false],
  });
  private readonly iconTouched = signal(false);
  protected readonly showPrivacy = computed(() => !this.initial() || this.initial()!.canChangePrivacy);

  ngOnInit(): void {
    const initial = this.initial();
    if (initial) this.form.setValue({ name: initial.name, type: initial.type, color: initial.color, icon: initial.icon, isPrivate: initial.isPrivate });
    this.form.controls.icon.valueChanges.subscribe(() => this.iconTouched.set(true));
  }

  /** Al cambiar de tipo sugiere su ícono, salvo que el usuario ya haya elegido otro */
  onType(type: ListType): void {
    if (!this.iconTouched()) this.form.controls.icon.setValue(LIST_TYPES.find((t) => t.id === type)!.defaultIcon, { emitEvent: false });
  }

  submit(): void {
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    this.saved.emit({ ...value, name: value.name.trim() });
  }
}
