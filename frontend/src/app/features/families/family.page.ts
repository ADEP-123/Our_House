import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FAMILY_AVATAR_PRESETS } from '../../shared/avatar-presets';
import { AvatarPickerComponent } from '../../shared/avatar-picker.component';
import { AvatarComponent } from '../../shared/avatar.component';
import { ConfirmService } from '../../shared/confirm.service';
import { FamiliesService, FamilyDetail, FamilyMember, FamilyRole, InvitationStatus, SentInvitation } from './families.service';
import { RoleDialogComponent } from './role-dialog.component';

const FALLBACK_CURRENCIES = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'GBP', 'CAD'];

type Area = 'header' | 'avatar' | 'members' | 'invite' | 'code' | 'leave';

@Component({
  selector: 'oh-family-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe, AvatarComponent, AvatarPickerComponent, RoleDialogComponent],
  templateUrl: './family.page.html',
  styleUrl: './family.page.scss',
})
export class FamilyPage implements OnInit {
  /** :id de la ruta (withComponentInputBinding) */
  readonly id = input.required<string>();

  private readonly store = inject(FamiliesService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly familyPresets = FAMILY_AVATAR_PRESETS;
  protected readonly family = signal<FamilyDetail | null>(null);
  protected readonly invitations = signal<SentInvitation[]>([]);
  protected readonly isLeader = computed(() => this.family()?.role === 'leader');
  protected readonly me = computed(() => this.auth.user()?.id);
  protected readonly leaderCount = computed(() => this.family()?.members.filter((m) => m.role === 'leader').length ?? 0);
  protected readonly loadError = signal<string | null>(null);

  protected readonly renaming = signal(false);
  protected readonly showAvatar = signal(false);
  protected readonly confirmExpel = signal<string | null>(null);
  protected readonly editingCurrency = signal(false);
  protected readonly currencyDraft = signal('USD');
  /** Monedas que conoce el navegador, con su nombre en el idioma de la app */
  protected readonly currencies = computed(() => {
    const locale = this.i18n.locale();
    const codes = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : FALLBACK_CURRENCIES;
    return codes.map((code) => ({ code, name: this.currencyName(code, locale) }));
  });
  /** Persona cuyo rol se está cambiando (diálogo abierto) */
  protected readonly editingRole = signal<FamilyMember | null>(null);
  protected readonly confirmLeave = signal(false);
  protected readonly copied = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<{ area: Area; text: string; error: boolean } | null>(null);

  protected readonly nameForm = this.fb.group({ name: ['', [Validators.required, Validators.maxLength(60)]] });
  protected readonly inviteForm = this.fb.group({ target: ['', Validators.required] });

  async ngOnInit(): Promise<void> {
    try {
      await this.refresh();
    } catch (err) {
      this.loadError.set(this.i18n.error(toApiError(err).code));
    }
  }

  private async refresh(): Promise<void> {
    const family = await this.store.detail(this.id());
    this.family.set(family);
    if (family.role === 'leader') this.invitations.set(await this.store.invitations(family.id));
  }

  protected displayName(m: FamilyMember): string {
    return m.firstName ? `${m.firstName} ${m.lastName ?? ''}`.trim() : m.nickname;
  }

  protected roleKey(role: FamilyRole): TranslationKey {
    return `families.roles.${role}`;
  }

  protected statusKey(status: InvitationStatus): TranslationKey {
    return `families.detail.status.${status}`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.locale(), { day: 'numeric', month: 'long' });
  }

  /** Ejecuta una acción, muestra el resultado en su zona y deja la pantalla al día. */
  private async act(area: Area, key: string, work: () => Promise<unknown>, success?: TranslationKey): Promise<boolean> {
    this.busy.set(key);
    this.message.set(null);
    try {
      await work();
      if (success) this.message.set({ area, text: this.i18n.t(success), error: false });
      return true;
    } catch (err) {
      this.message.set({ area, text: this.i18n.error(toApiError(err).code), error: true });
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  startRename(): void {
    this.nameForm.setValue({ name: this.family()!.name });
    this.renaming.set(true);
  }

  async rename(): Promise<void> {
    if (this.nameForm.invalid) return;
    const ok = await this.act('header', 'rename', async () =>
      this.family.set(await this.store.rename(this.id(), this.nameForm.controls.name.value.trim())),
    );
    if (ok) this.renaming.set(false);
  }

  uploadAvatar(file: File): void {
    void this.act('avatar', 'avatar', async () => this.family.set(await this.store.uploadAvatar(this.id(), file)));
  }

  pickAvatar(preset: string | null): void {
    void this.act('avatar', 'avatar', async () => this.family.set(await this.store.setAvatarPreset(this.id(), preset)));
  }

  protected currencyName(code: string, locale = this.i18n.locale()): string {
    try {
      return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  startCurrency(current: string): void {
    this.currencyDraft.set(current);
    this.editingCurrency.set(true);
  }

  async saveCurrency(): Promise<void> {
    const ok = await this.act('header', 'currency', async () => this.family.set(await this.store.setCurrency(this.id(), this.currencyDraft())));
    if (ok) this.editingCurrency.set(false);
  }

  /** Tras elegir en el diálogo: confirma con las consecuencias y, si es uno mismo, una segunda vez. */
  async changeRole(member: FamilyMember, role: FamilyRole): Promise<void> {
    const t = this.i18n.t.bind(this.i18n);
    const self = member.userId === this.me();
    const consequences = [t(`families.roleDialog.becomes_${role}`, { name: member.nickname })];
    if (member.role === 'leader') consequences.push(t('families.roleDialog.losesLeader'));
    if (member.role === 'supervised') consequences.push(t('families.roleDialog.losesSupervision'));
    const ok = await this.confirm.ask({
      title: t('families.roleDialog.confirmTitle', { name: member.nickname, role: t(this.roleKey(role)).toLocaleLowerCase(this.i18n.locale()) }),
      message: consequences.join(' '),
      confirmLabel: t('families.roleDialog.confirm'),
      cancelLabel: t('families.detail.cancel'),
    });
    if (!ok) return;
    if (self) {
      const sure = await this.confirm.ask({
        title: t('families.roleDialog.selfTitle'),
        message: t('families.roleDialog.selfMessage'),
        confirmLabel: t('families.roleDialog.selfConfirm'),
        cancelLabel: t('families.detail.cancel'),
        danger: true,
      });
      if (!sure) return;
    }
    await this.act('members', member.userId, async () => this.family.set(await this.store.setRole(this.id(), member.userId, role)));
  }

  async expel(member: FamilyMember): Promise<void> {
    const ok = await this.act('members', member.userId, async () =>
      this.family.set(await this.store.expel(this.id(), member.userId)),
    );
    if (ok) this.confirmExpel.set(null);
  }

  async invite(): Promise<void> {
    if (this.inviteForm.invalid) return;
    const ok = await this.act(
      'invite',
      'invite',
      async () => {
        await this.store.invite(this.id(), this.inviteForm.controls.target.value.trim());
        this.invitations.set(await this.store.invitations(this.id()));
      },
      'families.detail.invited',
    );
    if (ok) this.inviteForm.reset();
  }

  resend(inv: SentInvitation): void {
    void this.act('invite', inv.id, async () => {
      await this.store.resendInvitation(this.id(), inv.id);
      this.invitations.set(await this.store.invitations(this.id()));
    }, 'families.detail.invited');
  }

  cancel(inv: SentInvitation): void {
    void this.act('invite', inv.id, async () => {
      await this.store.cancelInvitation(this.id(), inv.id);
      this.invitations.set(await this.store.invitations(this.id()));
    });
  }

  async copyCode(): Promise<void> {
    await navigator.clipboard?.writeText(this.family()!.inviteCode ?? '').catch(() => undefined);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  regenerate(): void {
    void this.act('code', 'code', async () => {
      const inviteCode = await this.store.regenerateCode(this.id());
      this.family.update((f) => (f ? { ...f, inviteCode } : f));
    }, 'families.detail.regenerated');
  }

  async leave(): Promise<void> {
    const ok = await this.act('leave', 'leave', () => this.store.leave(this.id()));
    if (ok) await this.router.navigate(['/familias']);
  }
}
