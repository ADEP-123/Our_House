import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService, User } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { ThemeService } from '../../core/theme/theme.service';
import {
  DEFAULT_PATTERN,
  PATTERN_IDS,
  PATTERN_INTENSITIES,
  PatternIntensity,
  PatternSetting,
  patternCss,
  resolvePattern,
} from '../../core/theme/patterns';
import { effectiveTheme, seasonFor, seasonUntil } from '../../core/theme/seasons';
import { IconPickerComponent } from '../lists/icon-picker.component';
import {
  CLASSIC_PRESETS,
  ClassicId,
  COLOR_TOKENS,
  ColorToken,
  contrastIssues,
  DEFAULT_AUTO,
  DEFAULT_THEME,
  FESTIVITIES,
  Hemisphere,
  isDark,
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
  imports: [TPipe, IconPickerComponent],
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
  /** Lo que se verá hoy con el borrador (en modo automático, el tema de la temporada) */
  private readonly shown = computed(() => effectiveTheme(this.draft()));
  protected readonly previewStyle = computed(() => ThemeService.previewStyle(this.shown().colors));
  protected readonly previewPattern = computed(() => ThemeService.patternOf(this.draft()));

  /** Patrón de fondo: separado de los colores, se combina con cualquier tema */
  protected readonly patternChoices: PatternSetting['id'][] = ['theme', 'none', ...PATTERN_IDS, 'emoji'];
  protected readonly intensities = PATTERN_INTENSITIES;
  protected readonly pattern = computed(() => this.draft().pattern ?? DEFAULT_PATTERN);
  protected readonly issues = computed(() => contrastIssues(this.shown().colors));

  /** Modo automático por temporada */
  protected readonly auto = computed(() => this.draft().auto ?? DEFAULT_AUTO);
  protected readonly hemispheres: Hemisphere[] = ['north', 'south'];
  protected readonly autoNow = computed(() => {
    const now = new Date();
    const { hemisphere } = this.auto();
    return {
      name: this.i18n.t(this.presetLabel(seasonFor(now, hemisphere))),
      until: seasonUntil(now, hemisphere).toLocaleDateString(this.i18n.locale(), { day: 'numeric', month: 'long' }),
    };
  });
  protected readonly dirty = computed(() => !sameTheme(this.draft(), this.saved()));
  protected readonly isDefault = computed(() => sameTheme(this.draft(), DEFAULT_THEME));

  /** Los temas de temporada se eligen en su versión clara u oscura */
  protected readonly darkSeasonal = signal(this.saved().auto?.enabled ? this.saved().auto!.dark : isDarkVariant(this.saved().preset));
  protected readonly seasonalSelected = computed(() => (this.auto().enabled ? null : seasonalBase(this.draft().preset)));

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
    if (this.auto().enabled) this.updateAuto({ dark: this.darkSeasonal() });
    const selected = this.seasonalSelected();
    if (selected) this.chooseSeasonal(selected);
  }

  /** Elegir un tema o un color apaga el modo automático */
  private manual(theme: Theme): Theme['auto'] {
    return theme.auto ? { ...theme.auto, enabled: false } : undefined;
  }

  choosePreset(id: PresetId): void {
    this.draft.update((theme) => ({ ...theme, preset: id, colors: { ...PRESETS[id] }, auto: this.manual(theme) }));
    this.message.set(null);
  }

  setColor(token: ColorToken, value: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    const base = this.shown();
    this.draft.update((theme) => ({
      ...theme,
      preset: 'custom',
      colors: { ...base.colors, [token]: value.toLowerCase() } as ThemeColors,
      auto: this.manual(theme),
    }));
    this.message.set(null);
  }

  private updateAuto(change: Partial<NonNullable<Theme['auto']>>): void {
    this.draft.update((theme) => ({ ...theme, auto: { ...(theme.auto ?? { ...DEFAULT_AUTO, dark: this.darkSeasonal() }), ...change } }));
    this.message.set(null);
  }

  setAuto(enabled: boolean): void {
    this.updateAuto({ enabled, dark: this.darkSeasonal() });
  }

  setHemisphere(hemisphere: Hemisphere): void {
    this.updateAuto({ hemisphere });
  }

  protected hemisphereLabel(h: Hemisphere): string {
    return this.i18n.t(`appearance.auto.${h}`);
  }

  protected patternLabel(id: PatternSetting['id']): string {
    return this.i18n.t(`appearance.pattern.names.${id}`);
  }

  protected intensityLabel(id: PatternIntensity): string {
    return this.i18n.t(`appearance.pattern.${id}`);
  }

  /** Muestra de cada opción con los colores del borrador */
  protected patternSample(id: PatternSetting['id']): string {
    const theme = this.draft();
    const emoji = id === 'emoji' ? (this.pattern().emoji ?? '⭐') : undefined;
    const pattern = resolvePattern({ id, emoji, intensity: 'medium' }, seasonalBase(theme.preset));
    return patternCss(pattern, theme.colors, 'medium', isDark(theme.colors));
  }

  private updatePattern(change: Partial<PatternSetting>): void {
    this.draft.update((theme) => ({ ...theme, pattern: { ...(theme.pattern ?? DEFAULT_PATTERN), ...change } }));
    this.message.set(null);
  }

  setPattern(id: PatternSetting['id']): void {
    this.updatePattern(id === 'emoji' ? { id, emoji: this.pattern().emoji ?? '⭐' } : { id });
  }

  setPatternEmoji(emoji: string): void {
    this.updatePattern({ id: 'emoji', emoji });
  }

  setIntensity(intensity: PatternIntensity): void {
    this.updatePattern({ intensity });
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
