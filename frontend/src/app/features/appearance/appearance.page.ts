import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService, User } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ThemeService } from '../../core/theme/theme.service';
import {
  CLASSIC_PRESETS,
  ClassicId,
  COLOR_TOKENS,
  ColorToken,
  contrastIssues,
  DEFAULT_THEME,
  FESTIVITIES,
  isDarkVariant,
  MIN_CONTRAST,
  PRESETS,
  PresetId,
  sameTheme,
  SeasonalId,
  seasonalBase,
  seasonalPreset,
  SEASONS,
  Theme,
  ThemeColors,
} from '../../core/theme/themes';


@Component({
  selector: 'oh-appearance-page',
  imports: [TPipe],
  templateUrl: './appearance.page.html',
  styleUrl: './appearance.page.scss',
})
export class AppearancePage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);

  protected readonly presetIds = CLASSIC_PRESETS;
  protected readonly seasonalGroups: { ids: readonly SeasonalId[]; label: TranslationKey }[] = [
    { ids: SEASONS, label: 'appearance.seasonsGroup' },
    { ids: FESTIVITIES, label: 'appearance.festivitiesGroup' },
  ];
  protected readonly presets = PRESETS;
  protected readonly tokens = COLOR_TOKENS;
  protected readonly minContrast = MIN_CONTRAST;

  private readonly saved = computed<Theme>(() => this.auth.user()?.theme ?? DEFAULT_THEME);
  /** Borrador que se edita; la app no cambia hasta guardar */
  protected readonly draft = signal<Theme>(structuredClone(this.saved()));
  protected readonly previewStyle = computed(() => ThemeService.previewStyle(this.draft().colors));
  protected readonly issues = computed(() => contrastIssues(this.draft().colors));
  protected readonly dirty = computed(() => !sameTheme(this.draft(), this.saved()));
  protected readonly isDefault = computed(() => sameTheme(this.draft(), DEFAULT_THEME));

  /** Los temas de temporada se eligen en su versión clara u oscura */
  protected readonly darkSeasonal = signal(isDarkVariant(this.saved().preset));
  protected readonly seasonalSelected = computed(() => seasonalBase(this.draft().preset));

  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly isError = signal(false);

  protected tokenLabel(token: ColorToken): TranslationKey {
    return `appearance.tokens.${token}` as TranslationKey;
  }

  protected presetLabel(id: ClassicId | SeasonalId): TranslationKey {
    return `appearance.presets.${id}`;
  }

  protected seasonalColors(id: SeasonalId): ThemeColors {
    return PRESETS[seasonalPreset(id, this.darkSeasonal())];
  }

  chooseSeasonal(id: SeasonalId): void {
    this.choosePreset(seasonalPreset(id, this.darkSeasonal()));
  }

  /** Cambia entre la versión clara y oscura; si hay un tema de temporada elegido, cambia también */
  toggleDarkSeasonal(): void {
    this.darkSeasonal.update((dark) => !dark);
    const selected = this.seasonalSelected();
    if (selected) this.chooseSeasonal(selected);
  }

  choosePreset(id: PresetId): void {
    this.draft.set({ preset: id, colors: { ...PRESETS[id] } });
    this.message.set(null);
  }

  setColor(token: ColorToken, value: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    this.draft.update((theme) => ({ preset: 'custom', colors: { ...theme.colors, [token]: value.toLowerCase() } as ThemeColors }));
    this.message.set(null);
  }

  /** Vuelve al tema claro original (borrador; se aplica al guardar). */
  resetDraft(): void {
    this.draft.set(structuredClone(DEFAULT_THEME));
    this.message.set(null);
  }

  discard(): void {
    this.draft.set(structuredClone(this.saved()));
    this.message.set(null);
  }

  async save(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      const theme = this.isDefault() ? null : this.draft();
      const { user } = await firstValueFrom(this.http.put<{ user: User }>('/api/me/theme', { theme }));
      this.auth.setUser(user);
      this.isError.set(false);
      this.message.set(this.i18n.t('appearance.saved'));
    } catch (err) {
      this.isError.set(true);
      this.message.set(this.i18n.error(toApiError(err).code));
    } finally {
      this.busy.set(false);
    }
  }
}
