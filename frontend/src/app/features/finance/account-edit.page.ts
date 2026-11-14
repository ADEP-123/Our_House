import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FamiliesService, FamilyMember, FamilyRole } from '../families/families.service';
import {
  ACCOUNT_KINDS,
  localToday,
  movementCode,
  normalizePrefix,
  suggestPrefix,
} from './finance-logic';
import { Account, AccountInput, AccountKind, EditMode, ViewMode } from './finance.models';
import { FinanceService } from './finance.service';
import { FinancePracticeBannerComponent } from './tutorial/finance-practice-banner.component';

const ROLES: FamilyRole[] = ['leader', 'member', 'supervised'];

/** Copia del conjunto con el valor agregado o quitado */
function flip<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Crear o editar una cuenta: datos, saldo inicial y permisos.
 * /finanzas/cuentas/nueva?familia=… y /finanzas/cuentas/:id/editar
 */
@Component({
  selector: 'oh-account-edit-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe, FinancePracticeBannerComponent],
  templateUrl: './account-edit.page.html',
  styleUrl: './account-edit.page.scss',
})
export class AccountEditPage implements OnInit {
  /** :id de la ruta (editar) */
  readonly id = input<string>();
  /** ?familia= (crear): grupo donde se crea; si no, el activo */
  readonly familia = input<string>();

  protected readonly families = inject(FamiliesService);
  private readonly finance = inject(FinanceService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly fb = inject(FormBuilder);

  protected readonly kinds = ACCOUNT_KINDS;
  protected readonly roles = ROLES;
  protected readonly viewModes: { id: ViewMode; label: TranslationKey }[] = [
    { id: 'family', label: 'finance.form.viewFamily' },
    { id: 'members', label: 'finance.form.viewMembers' },
    { id: 'private', label: 'finance.form.viewPrivate' },
  ];

  protected readonly account = signal<Account | null>(null);
  protected readonly familyId = signal<string | null>(null);
  protected readonly family = computed(
    () => this.families.families()?.find((f) => f.id === this.familyId()) ?? null,
  );
  protected readonly members = signal<FamilyMember[]>([]);
  private readonly takenPrefixes = signal<string[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  /** Mientras la persona no cambie el prefijo, sigue al nombre */
  private prefixTouched = false;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    description: ['', Validators.maxLength(280)],
    kind: ['bank' as AccountKind],
    prefix: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{1,4}$/)]],
    creditLimit: [null as number | null],
    lowBalanceThreshold: [null as number | null],
    openingAmount: [null as number | null],
    openingDate: [localToday()],
    viewMode: ['family' as ViewMode],
    editMode: ['roles' as EditMode],
  });
  protected readonly editRoles = signal<Set<FamilyRole>>(new Set(['leader', 'member']));
  protected readonly viewers = signal<Set<string>>(new Set());
  protected readonly editors = signal<Set<string>>(new Set());

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  protected readonly kind = computed(() => this.value().kind ?? 'bank');
  protected readonly viewMode = computed(() => this.value().viewMode ?? 'family');
  protected readonly editMode = computed(() => this.value().editMode ?? 'roles');
  protected readonly example = computed(() => movementCode(this.value().prefix || 'T', 1));

  /** Personas que se pueden elegir: todas menos quien administra la cuenta */
  protected readonly others = computed(() => {
    const ownerId = this.account() ? this.account()!.owner?.id : this.auth.user()?.id;
    return this.members().filter((m) => m.userId !== ownerId);
  });

  constructor() {
    // El prefijo sigue al nombre (con el valor ya actualizado del control)
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onName());
    // En tarjetas el monto se escribe como deuda (positivo); al cambiar de tipo se invierte
    // para que el saldo guardado siga siendo el mismo
    let wasCredit = this.form.controls.kind.value === 'credit';
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((kind) => {
      const isCredit = kind === 'credit';
      const amount = this.form.controls.openingAmount.value;
      if (isCredit !== wasCredit && amount) this.form.controls.openingAmount.setValue(-amount);
      wasCredit = isCredit;
    });
    effect(() => {
      const familyId = this.familyId();
      if (!familyId) return;
      untracked(() => void this.loadFamily(familyId));
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.families.families() === null) await this.families.load().catch(() => undefined);
    const id = this.id();
    if (!id) {
      this.familyId.set(this.familia() ?? this.families.active()?.id ?? null);
      return;
    }
    this.loading.set(true);
    try {
      const a = await this.finance.account(id);
      this.account.set(a);
      this.prefixTouched = true;
      const credit = a.kind === 'credit';
      this.form.setValue({
        name: a.name,
        description: a.description ?? '',
        kind: a.kind,
        prefix: a.prefix,
        creditLimit: a.credit?.limit ?? null,
        lowBalanceThreshold: a.lowBalanceThreshold ?? null,
        // En tarjetas se escribe la deuda en positivo
        openingAmount: a.opening ? (credit ? -a.opening.amount : a.opening.amount) : null,
        openingDate: a.opening?.date ?? localToday(),
        viewMode: a.viewMode,
        editMode: a.editMode,
      });
      this.editRoles.set(new Set(a.editRoles));
      this.viewers.set(new Set(a.viewers));
      this.editors.set(new Set(a.editors));
      this.familyId.set(a.familyId);
    } catch (err) {
      this.error.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFamily(familyId: string): Promise<void> {
    const [detail, active, archived] = await Promise.all([
      this.families.detail(familyId).catch(() => null),
      this.finance.accounts(familyId).catch(() => null),
      this.finance.accounts(familyId, true).catch(() => null),
    ]);
    this.members.set(detail?.members ?? []);
    const own = this.account()?.id;
    this.takenPrefixes.set(
      [...(active?.accounts ?? []), ...(archived?.accounts ?? [])]
        .filter((a) => a.id !== own)
        .map((a) => a.prefix),
    );
    if (!this.prefixTouched) this.onName();
  }

  protected onName(): void {
    if (this.prefixTouched) return;
    this.form.controls.prefix.setValue(
      suggestPrefix(this.form.controls.name.value, this.takenPrefixes()),
    );
  }

  protected onPrefix(event: Event): void {
    this.prefixTouched = true;
    const value = normalizePrefix((event.target as HTMLInputElement).value);
    this.form.controls.prefix.setValue(value);
    (event.target as HTMLInputElement).value = value;
  }

  protected roleLabel(role: FamilyRole): string {
    return this.i18n.t(`finance.roles.${role}`);
  }

  protected kindLabel(kind: AccountKind): string {
    return this.i18n.t(`finance.kinds.${kind}`);
  }

  protected toggleRole(role: FamilyRole): void {
    this.editRoles.update((s) => flip(s, role));
  }

  protected toggleViewer(id: string): void {
    this.viewers.update((s) => flip(s, id));
  }

  protected toggleEditor(id: string): void {
    this.editors.update((s) => flip(s, id));
  }

  protected fieldError(name: string): string | null {
    const code = this.fieldErrors()[name];
    return code ? this.i18n.error(code) : null;
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    const v = this.form.getRawValue();
    const credit = v.kind === 'credit';
    const opening = v.openingAmount
      ? { amount: credit ? -v.openingAmount : v.openingAmount, date: v.openingDate }
      : null;
    const input: AccountInput = {
      name: v.name.trim(),
      description: v.description.trim() || null,
      kind: v.kind,
      prefix: v.prefix,
      creditLimit: credit ? (v.creditLimit ?? null) : null,
      lowBalanceThreshold: credit ? null : (v.lowBalanceThreshold ?? null),
      opening,
      viewMode: v.viewMode,
      editMode: v.editMode,
      editRoles: ROLES.filter((r) => this.editRoles().has(r)),
      viewers: [...this.viewers()],
      editors: [...this.editors()],
    };

    this.busy.set(true);
    this.error.set(null);
    this.fieldErrors.set({});
    try {
      const existing = this.account();
      const saved = existing
        ? await this.finance.update(existing.id, input)
        : await this.finance.create(this.familyId()!, input);
      await this.router.navigate(['/finanzas'], { queryParams: { cuenta: saved.id } });
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'VALIDATION') this.fieldErrors.set(e.fields);
      else if (e.code === 'ACCOUNT_PREFIX_TAKEN') this.fieldErrors.set({ prefix: e.code });
      else this.error.set(this.i18n.error(e.code, e.details));
    } finally {
      this.busy.set(false);
    }
  }

  cancel(): void {
    const id = this.account()?.id;
    void this.router.navigate(['/finanzas'], { queryParams: id ? { cuenta: id } : {} });
  }
}
