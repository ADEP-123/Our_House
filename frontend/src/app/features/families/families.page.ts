import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { FAMILY_AVATAR_PRESETS } from '../../shared/avatar-presets';
import { AvatarComponent } from '../../shared/avatar.component';
import { FamiliesService, FamilyRole } from './families.service';

@Component({
  selector: 'oh-families-page',
  imports: [ReactiveFormsModule, RouterLink, TPipe, AvatarComponent],
  templateUrl: './families.page.html',
  styleUrl: './families.page.scss',
})
export class FamiliesPage implements OnInit {
  protected readonly store = inject(FamiliesService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly familyPresets = FAMILY_AVATAR_PRESETS;
  protected readonly createForm = this.fb.group({ name: ['', [Validators.required, Validators.maxLength(60)]] });
  protected readonly joinForm = this.fb.group({ code: ['', [Validators.required, Validators.minLength(4)]] });
  protected readonly busy = signal<string | null>(null);
  protected readonly message = signal<{ text: string; error: boolean; where: 'create' | 'join' | 'received' } | null>(null);

  async ngOnInit(): Promise<void> {
    await this.store.load().catch((err) => this.fail('received', err));
  }

  protected roleKey(role: FamilyRole): TranslationKey {
    return `families.roles.${role}`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.locale(), { day: 'numeric', month: 'long' });
  }

  private fail(where: 'create' | 'join' | 'received', err: unknown): void {
    this.message.set({ text: this.i18n.error(toApiError(err).code), error: true, where });
  }

  async create(): Promise<void> {
    if (this.createForm.invalid) return;
    this.busy.set('create');
    this.message.set(null);
    try {
      const family = await this.store.create(this.createForm.controls.name.value.trim());
      await this.router.navigate(['/familias', family.id]);
    } catch (err) {
      this.fail('create', err);
    } finally {
      this.busy.set(null);
    }
  }

  async join(): Promise<void> {
    if (this.joinForm.invalid) return;
    this.busy.set('join');
    this.message.set(null);
    try {
      const family = await this.store.join(this.joinForm.controls.code.value.replace(/\s/g, ''));
      await this.router.navigate(['/familias', family.id]);
    } catch (err) {
      this.fail('join', err);
    } finally {
      this.busy.set(null);
    }
  }

  async respond(invitationId: string, accept: boolean): Promise<void> {
    this.busy.set(invitationId);
    this.message.set(null);
    try {
      await this.store.respond(invitationId, accept);
    } catch (err) {
      this.fail('received', err);
    } finally {
      this.busy.set(null);
    }
  }
}
