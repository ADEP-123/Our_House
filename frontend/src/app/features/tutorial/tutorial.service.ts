import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, User } from '../../core/auth/auth.service';
import { I18n, TranslationKey } from '../../core/i18n/i18n.service';
import { ToastService } from '../../shared/toast.service';
import { PracticeMode } from './practice-mode.service';

export type TutorialId = 'lists' | 'account' | 'calendar';
export type TutorialState = { state: 'done' | 'skipped' | 'progress'; step?: number };

export interface TourStep {
  id: string;
  /** Elemento a resaltar (selector CSS); sin él, la tarjeta va al centro */
  target?: string;
  title: TranslationKey;
  body: TranslationKey;
  /** El paso pide hacer algo: avanza solo cuando esto se cumple */
  until?: () => boolean;
  /** Deja la práctica lista para este paso (al retomar o volver atrás); no debe borrar lo que ya hay */
  ensure?: () => void;
}

/** Pasos opcionales que se ofrecen al terminar los básicos */
export interface TourExtra {
  id: string;
  title: TranslationKey;
  steps: TourStep[];
}

export interface TourDefinition {
  id: TutorialId;
  steps: TourStep[];
  extras: TourExtra[];
  /** Botón extra en la tarjeta final (p. ej. "Conectar de verdad") */
  finalAction?: { label: TranslationKey; run: () => void };
}

/** Pantalla de práctica de cada tutorial */
const PRACTICE_ROUTES: Record<TutorialId, string> = {
  lists: '/tutorial/listas',
  account: '/tutorial/cuenta',
  calendar: '/tutorial/calendario',
};

/**
 * Tutoriales interactivos: invitación la primera vez que se entra a un módulo, pasos guiados sobre
 * una copia de la pantalla (modo práctica) y el estado de cada uno guardado en la cuenta
 * (visto, saltado o en qué paso quedó), así no vuelve a aparecer en otro dispositivo.
 */
@Injectable({ providedIn: 'root' })
export class TutorialService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly practice = inject(PracticeMode);

  /** Invitación abierta: "¿Te muestro cómo…?" (step = paso donde quedó, si lo dejó a medias) */
  readonly invite = signal<{ id: TutorialId; step: number | null } | null>(null);
  private readonly definition = signal<TourDefinition | null>(null);
  private readonly extra = signal<TourExtra | null>(null);
  readonly index = signal(0);
  /** Se terminaron los pasos: tarjeta final con los opcionales */
  readonly atEnd = signal(false);

  readonly running = computed(() => !!this.definition());
  readonly tour = this.definition.asReadonly();
  readonly currentExtra = this.extra.asReadonly();
  readonly steps = computed(() => this.extra()?.steps ?? this.definition()?.steps ?? []);
  readonly step = computed(() => (this.atEnd() ? null : (this.steps()[this.index()] ?? null)));
  /** Opcionales que todavía no vio en esta vuelta */
  readonly pendingExtras = computed(() =>
    (this.definition()?.extras ?? []).filter((x) => !this.extrasDone().has(x.id)),
  );
  private readonly extrasDone = signal<ReadonlySet<string>>(new Set());

  private startAt = 0;
  private returnUrl = '/inicio';
  /** Invitaciones ya mostradas en esta sesión (si la cierra sin elegir, no insiste) */
  private readonly offered = new Set<TutorialId>();

  stateOf(id: TutorialId): TutorialState | undefined {
    return this.auth.user()?.tutorials?.[id];
  }

  seen(id: TutorialId): boolean {
    const state = this.stateOf(id)?.state;
    return state === 'done' || state === 'skipped';
  }

  /** Primera vez en el módulo: invita a ver el tutorial (o a seguir donde quedó) */
  offer(id: TutorialId): void {
    if (
      this.practice.active() ||
      this.running() ||
      this.invite() ||
      !this.auth.user() ||
      this.seen(id) ||
      this.offered.has(id)
    )
      return;
    this.offered.add(id);
    const state = this.stateOf(id);
    this.invite.set({ id, step: state?.state === 'progress' ? (state.step ?? 0) : null });
  }

  /** Abre la práctica (desde la invitación o el botón "?") */
  start(id: TutorialId, step = 0): void {
    this.invite.set(null);
    this.offered.add(id);
    this.startAt = step;
    this.returnUrl = this.router.url.startsWith('/tutorial/') ? '/inicio' : this.router.url;
    this.practice.start();
    void this.router.navigateByUrl(PRACTICE_ROUTES[id]);
  }

  /** "Saltar" en la invitación: cuenta como visto */
  skipInvite(): void {
    const invite = this.invite();
    if (!invite) return;
    this.invite.set(null);
    void this.save(invite.id, { state: 'skipped' });
    this.toast.show(this.i18n.t('tutorial.skippedToast'));
  }

  /** La pantalla de práctica entrega sus pasos */
  attach(definition: TourDefinition): void {
    // También si se llegó a la práctica escribiendo la dirección o recargando
    this.practice.start();
    this.definition.set(definition);
    this.extra.set(null);
    this.extrasDone.set(new Set());
    this.atEnd.set(false);
    this.index.set(Math.min(this.startAt, definition.steps.length - 1));
    this.startAt = 0;
    this.step()?.ensure?.();
  }

  /** Se salió de la práctica por otro camino (menú, atrás del navegador): queda donde iba */
  detach(definition: TourDefinition): void {
    if (this.definition() !== definition) return;
    this.definition.set(null);
    this.extra.set(null);
    this.practice.end();
  }

  next(): void {
    const steps = this.steps();
    if (this.index() + 1 < steps.length) {
      this.index.update((i) => i + 1);
      this.step()?.ensure?.();
      if (!this.extra())
        void this.save(this.definition()!.id, { state: 'progress', step: this.index() });
      return;
    }
    // Terminó los básicos (o un opcional): tarjeta final
    const extra = this.extra();
    if (extra) this.extrasDone.update((s) => new Set(s).add(extra.id));
    else void this.save(this.definition()!.id, { state: 'done' });
    this.extra.set(null);
    this.atEnd.set(true);
  }

  back(): void {
    if (this.index() === 0) return;
    this.index.update((i) => i - 1);
    this.step()?.ensure?.();
  }

  runExtra(extra: TourExtra): void {
    this.extra.set(extra);
    this.atEnd.set(false);
    this.index.set(0);
    this.step()?.ensure?.();
  }

  /** "Saltar tutorial" en medio de la práctica: cuenta como visto */
  skip(): void {
    const definition = this.definition();
    if (!definition) return;
    if (!this.seen(definition.id)) void this.save(definition.id, { state: 'skipped' });
    this.close();
    this.toast.show(this.i18n.t('tutorial.skippedToast'));
  }

  /** Salir de la práctica sin marcarlo: la próxima vez ofrece seguir donde quedó */
  pause(): void {
    this.close();
  }

  finish(action?: () => void): void {
    const definition = this.definition();
    if (definition && !this.seen(definition.id)) void this.save(definition.id, { state: 'done' });
    this.close(action);
  }

  private close(then?: () => void): void {
    this.definition.set(null);
    this.extra.set(null);
    this.atEnd.set(false);
    this.practice.end();
    if (then) then();
    else void this.router.navigateByUrl(this.returnUrl);
  }

  /** Guarda el estado en la cuenta; solo cambia "tutorials", así no pisa nada de la práctica */
  async save(id: TutorialId | 'getting-started', value: TutorialState): Promise<void> {
    const before = this.auth.user();
    if (!before) return;
    const tutorials = { ...before.tutorials, [id]: value };
    this.auth.setUser({ ...before, tutorials });
    try {
      const { user } = await firstValueFrom(
        this.http.put<{ user: User }>(`/api/me/tutorials/${id}`, value),
      );
      const current = this.auth.user();
      if (current) this.auth.setUser({ ...current, tutorials: user.tutorials });
    } catch {
      // Sin conexión: se vuelve a guardar la próxima vez que avance
    }
  }
}
