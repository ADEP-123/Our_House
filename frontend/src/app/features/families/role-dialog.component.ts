import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import { TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FamilyRole } from './families.service';

const ROLES: { id: FamilyRole; label: TranslationKey; hint: TranslationKey }[] = [
  { id: 'leader', label: 'families.roles.leader', hint: 'families.roleDialog.leaderHint' },
  { id: 'member', label: 'families.roles.member', hint: 'families.roleDialog.memberHint' },
  { id: 'supervised', label: 'families.roles.supervised', hint: 'families.roleDialog.supervisedHint' },
];

/**
 * Diálogo para elegir el rol de una persona. Nada cambia hasta pulsar Guardar;
 * la página pide después la confirmación con las consecuencias.
 */
@Component({
  selector: 'oh-role-dialog',
  imports: [TPipe],
  template: `
    <dialog #dialog (close)="closed.emit()" aria-labelledby="role-title">
      <h2 id="role-title">{{ 'families.roleDialog.title' | t: { name: name() } }}</h2>
      <fieldset>
        <legend class="oh-sr-only">{{ 'families.detail.roleOf' | t: { name: name() } }}</legend>
        @for (role of roles; track role.id) {
          <label class="option" [class.selected]="selected() === role.id">
            <input type="radio" name="role" [value]="role.id" [checked]="selected() === role.id" (change)="selected.set(role.id)" />
            <span>
              <strong>{{ role.label | t }}</strong>
              @if (role.id === current()) {
                <span class="current">· {{ 'families.roleDialog.current' | t }}</span>
              }
              <small>{{ role.hint | t }}</small>
            </span>
          </label>
        }
      </fieldset>
      <div class="actions">
        <button type="button" class="oh-btn oh-btn--text" (click)="close()">{{ 'families.detail.cancel' | t }}</button>
        <button type="button" class="oh-btn oh-btn--filled" [disabled]="selected() === current()" (click)="save()">
          {{ 'families.roleDialog.save' | t }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(92vw, 460px);
      padding: 24px;
      border: 0;
      border-radius: var(--oh-radius-lg);
      background: var(--oh-surface);
      color: var(--oh-text);
      box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.4);
    }
    h2 {
      font-size: 1.125rem;
      margin-bottom: 16px;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 8px;
    }
    .option {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--oh-text) 15%, transparent);
      cursor: pointer;
    }
    .option.selected {
      border-color: var(--oh-primary);
      background: color-mix(in srgb, var(--oh-primary) 8%, var(--oh-surface));
    }
    .option input {
      margin-top: 3px;
      accent-color: var(--oh-primary);
    }
    small {
      display: block;
      margin-top: 2px;
      color: var(--oh-text-muted);
      line-height: 1.4;
    }
    .current {
      margin-left: 4px;
      color: var(--oh-text-muted);
      font-size: 0.875rem;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }
  `,
})
export class RoleDialogComponent {
  readonly name = input.required<string>();
  readonly current = input.required<FamilyRole>();
  readonly saved = output<FamilyRole>();
  readonly closed = output<void>();

  protected readonly roles = ROLES;
  protected readonly selected = signal<FamilyRole>('member');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // Se monta cuando la página lo abre: muestra el rol actual seleccionado
    effect(() => {
      this.selected.set(this.current());
      const el = this.dialog().nativeElement;
      if (!el.open) el.showModal();
    });
  }

  protected save(): void {
    this.saved.emit(this.selected());
    this.dialog().nativeElement.close();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }
}
