import { Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconPickerComponent } from './icon-picker.component';
import { DEFAULT_FEATURES, LIST_COLORS, LIST_FEATURES, LIST_TYPES, ListFeature, ListType } from './list-presets';
import { ListInput } from './lists.models';

/** Formulario de crear / editar lista. El tipo solo se elige al crear; las opciones se cambian cuando se quiera. */
@Component({
  selector: 'oh-list-form',
  imports: [ReactiveFormsModule, TPipe, IconPickerComponent],
  template: `
    <form class="oh-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      @if (showTitle()) {
        <h2>{{ (initial() ? 'lists.form.editTitle' : 'lists.form.createTitle') | t }}</h2>
      }

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

      @if (form.controls.type.value === 'secret') {
        <p class="oh-alert" role="note">🔐 {{ 'secrets.formHint' | t }}</p>
      } @else {
      <fieldset>
        <legend>{{ 'lists.features.title' | t }}</legend>
        <p class="oh-hint">{{ 'lists.features.intro' | t }}</p>
        <div class="features">
          @for (f of featureOptions; track f.id) {
            <label class="feature" [class.on]="features().has(f.id)">
              <input type="checkbox" [checked]="features().has(f.id)" (change)="toggleFeature(f.id)" />
              <span>
                <strong>{{ f.label | t }}</strong>
                <small>{{ f.hint | t }}</small>
              </span>
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
        <oh-icon-picker [value]="icon()" (valueChange)="pickIcon($event)" />
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

      <!-- Lo que agrega la pantalla (elementos para empezar) va antes de los botones -->
      <ng-content />

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
    .swatches {
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
    .features {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    }
    .feature {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--oh-border-strong);
      cursor: pointer;
    }
    .feature.on {
      border-color: var(--oh-primary);
      background: color-mix(in srgb, var(--oh-primary) 8%, var(--oh-surface));
    }
    .feature input {
      flex: none;
      margin-top: 2px;
      width: 18px;
      height: 18px;
      accent-color: var(--oh-primary);
    }
    .feature small {
      display: block;
      margin-top: 2px;
      color: var(--oh-text-muted);
      font-size: 0.8125rem;
      line-height: 1.35;
    }
  `,
})
export class ListFormComponent implements OnInit {
  readonly initial = input<(ListInput & { canChangePrivacy: boolean }) | null>(null);
  /** El usuario es miembro supervisado del grupo: se le avisa que los líderes ven sus privadas */
  readonly supervised = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  /** Al crear: datos de una plantilla para llenar el formulario */
  readonly preset = input<Omit<ListInput, 'isPrivate' | 'features'> & { features?: ListFeature[] } | null>(null);
  readonly showTitle = input(true);
  readonly saved = output<ListInput>();
  readonly cancelled = output<void>();
  /** El tipo elegido cambió (para traer sugerencias de ese tipo) */
  readonly typeChanged = output<ListType>();

  protected readonly types = LIST_TYPES;
  protected readonly featureOptions = LIST_FEATURES;
  /** Opciones elegidas; al crear arrancan con las del tipo */
  protected readonly features = signal<ReadonlySet<ListFeature>>(new Set(DEFAULT_FEATURES.todo));
  protected readonly colors = Object.entries(LIST_COLORS);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    type: ['todo' as ListType],
    color: ['blue'],
    icon: ['check'],
    isPrivate: [false],
  });
  private readonly iconTouched = signal(false);
  /** Ícono elegido (en una señal para que la pantalla se actualice al instante) */
  protected readonly icon = signal('check');
  protected readonly showPrivacy = computed(() => !this.initial() || this.initial()!.canChangePrivacy);

  constructor() {
    // Elegir una plantilla llena el formulario; el nombre solo si todavía no se escribió otro
    effect(() => {
      const preset = this.preset();
      if (!preset || this.initial()) return;
      untracked(() => {
        const name = this.form.controls.name;
        if (preset.name || !name.dirty) name.setValue(preset.name);
        this.form.patchValue({ type: preset.type, color: preset.color }, { emitEvent: false });
        this.setIcon(preset.icon);
        this.iconTouched.set(false);
        this.features.set(new Set(preset.features ?? DEFAULT_FEATURES[preset.type]));
        this.typeChanged.emit(preset.type);
      });
    });
  }

  ngOnInit(): void {
    const initial = this.initial();
    if (initial) {
      this.form.setValue({ name: initial.name, type: initial.type, color: initial.color, icon: initial.icon, isPrivate: initial.isPrivate });
      this.icon.set(initial.icon);
      this.features.set(new Set(initial.features ?? DEFAULT_FEATURES[initial.type]));
    }
  }

  /** Al cambiar de tipo sugiere su ícono, salvo que el usuario ya haya elegido otro */
  onType(type: ListType): void {
    this.features.set(new Set(DEFAULT_FEATURES[type]));
    this.typeChanged.emit(type);
    if (!this.iconTouched()) this.setIcon(LIST_TYPES.find((t) => t.id === type)!.defaultIcon);
  }

  protected pickIcon(icon: string): void {
    this.setIcon(icon);
    this.iconTouched.set(true);
  }

  private setIcon(icon: string): void {
    this.icon.set(icon);
    this.form.controls.icon.setValue(icon);
  }

  toggleFeature(id: ListFeature): void {
    this.features.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  submit(): void {
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    // En el orden de la lista de opciones, para comparar fácil
    const features = value.type === 'secret' ? [] : LIST_FEATURES.map((f) => f.id).filter((id) => this.features().has(id));
    this.saved.emit({ ...value, name: value.name.trim(), features });
  }
}
