import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslationKey } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { TourExtra, TutorialService } from './tutorial.service';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 12;
const POLL_MS = 250;
/** Ancho mínimo de la tarjeta para ponerla al lado de algo alto */
const SIDE_MIN = 240;

/**
 * Capa de los tutoriales: la invitación, el resaltado del elemento de cada paso y su tarjeta.
 * Va en la capa superior del navegador (popover) y se vuelve a subir cuando se abre una ventana,
 * así las instrucciones siguen visibles sobre la ventana de un elemento.
 */
@Component({
  selector: 'oh-tour-overlay',
  imports: [TPipe],
  template: `
    <div #layer popover="manual" class="layer">
      @if (tutorial.invite(); as invite) {
        <div class="scrim"></div>
        <section
          class="card invite"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-invite-title"
        >
          <p class="eyebrow">🎓 {{ 'tutorial.eyebrow' | t }}</p>
          <h2 id="tour-invite-title">{{ inviteTitle(invite.id) | t }}</h2>
          <p>{{ 'tutorial.inviteBody' | t }}</p>
          <div class="actions">
            @if (invite.step !== null && invite.step > 0) {
              <button
                type="button"
                class="oh-btn oh-btn--filled"
                (click)="tutorial.start(invite.id, invite.step)"
              >
                {{ 'tutorial.resume' | t }}
              </button>
              <button
                type="button"
                class="oh-btn oh-btn--outline"
                (click)="tutorial.start(invite.id)"
              >
                {{ 'tutorial.restart' | t }}
              </button>
            } @else {
              <button
                type="button"
                class="oh-btn oh-btn--filled"
                (click)="tutorial.start(invite.id)"
              >
                {{ 'tutorial.start' | t }}
              </button>
            }
            <button type="button" class="oh-btn oh-btn--text" (click)="tutorial.skipInvite()">
              {{ 'tutorial.skip' | t }}
            </button>
          </div>
        </section>
      } @else if (tutorial.running()) {
        @if (hidden()) {
          <!-- Una ventana abierta: el paso sigue cuando se cierre -->
        } @else if (spot(); as r) {
          <div
            class="spot"
            [style.top.px]="r.top"
            [style.left.px]="r.left"
            [style.width.px]="r.width"
            [style.height.px]="r.height"
          ></div>
        } @else {
          <div class="scrim soft"></div>
        }
        <section
          #card
          class="card"
          [class.gone]="hidden()"
          [class.tight]="tight()"
          role="dialog"
          aria-live="polite"
          [style.top.px]="cardPos().top"
          [style.left.px]="cardPos().left"
          [style.width.px]="cardPos().width"
        >
          @if (tutorial.step(); as step) {
            <p class="eyebrow">
              @if (tutorial.currentExtra(); as extra) {
                {{ extra.title | t }} ·
              }
              {{
                'tutorial.stepOf' | t: { n: tutorial.index() + 1, total: tutorial.steps().length }
              }}
            </p>
            <h2>{{ step.title | t }}</h2>
            <p [class.clamp]="tight() && !expanded()">{{ step.body | t }}</p>
            @if (tight()) {
              <button
                type="button"
                class="toggle"
                [attr.aria-expanded]="expanded()"
                (click)="expanded.set(!expanded())"
              >
                {{ (expanded() ? 'tutorial.showLess' : 'tutorial.showMore') | t }}
              </button>
            }
            @if (step.until && !tight()) {
              <p class="doit">👆 {{ 'tutorial.doIt' | t }}</p>
            }
            <div class="actions">
              @if (tutorial.index() > 0) {
                <button type="button" class="oh-btn oh-btn--text" (click)="tutorial.back()">
                  {{ 'tutorial.back' | t }}
                </button>
              }
              <span class="spacer"></span>
              <button
                type="button"
                class="oh-btn"
                [class.oh-btn--filled]="!step.until"
                [class.oh-btn--outline]="!!step.until"
                (click)="tutorial.next()"
              >
                {{ 'tutorial.next' | t }}
              </button>
            </div>
            <button type="button" class="skip" (click)="tutorial.skip()">
              {{ 'tutorial.skipTutorial' | t }}
            </button>
          } @else {
            <p class="eyebrow">🎉 {{ 'tutorial.eyebrow' | t }}</p>
            <h2>{{ 'tutorial.doneTitle' | t }}</h2>
            <p>{{ 'tutorial.doneBody' | t }}</p>
            @if (tutorial.pendingExtras().length) {
              <p class="more">{{ 'tutorial.more' | t }}</p>
              <div class="extras">
                @for (extra of tutorial.pendingExtras(); track extra.id) {
                  <button type="button" class="oh-btn oh-btn--outline" (click)="runExtra(extra)">
                    {{ extra.title | t }}
                  </button>
                }
              </div>
            }
            <div class="actions">
              @if (tutorial.tour()?.finalAction; as action) {
                <button
                  type="button"
                  class="oh-btn oh-btn--outline"
                  (click)="tutorial.finish(action.run)"
                >
                  {{ action.label | t }}
                </button>
              }
              <span class="spacer"></span>
              <button type="button" class="oh-btn oh-btn--filled" (click)="tutorial.finish()">
                {{ 'tutorial.finish' | t }}
              </button>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .layer {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: visible;
      pointer-events: none;
      color: var(--oh-text);
    }
    .scrim {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 0.45);
      pointer-events: auto;
    }
    .scrim.soft {
      background: rgb(0 0 0 / 0.25);
      pointer-events: none;
    }
    /* Hueco iluminado sobre el elemento del paso; el resto se oscurece con la sombra */
    .spot {
      position: fixed;
      border-radius: 14px;
      box-shadow:
        0 0 0 3px var(--oh-primary),
        0 0 0 9999px rgb(0 0 0 / 0.4);
      transition:
        top 180ms ease,
        left 180ms ease,
        width 180ms ease,
        height 180ms ease;
      pointer-events: none;
    }
    .card {
      position: fixed;
      width: min(380px, calc(100vw - 24px));
      display: grid;
      gap: 8px;
      padding: 18px 18px 12px;
      border-radius: var(--oh-radius-lg);
      background: var(--oh-surface);
      box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
      pointer-events: auto;
    }
    @media (max-width: 599px) {
      .card:not(.invite) {
        max-height: 45vh;
        overflow-y: auto;
      }
    }
    /* Celular con algo alto resaltado (una ventana): la tarjeta se achica para no taparla */
    .card.tight {
      gap: 4px;
      padding: 12px 14px 8px;
    }
    .clamp {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .toggle {
      justify-self: start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--oh-primary);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }
    .card.gone {
      display: none;
    }
    .card.invite {
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%);
      width: min(440px, calc(100vw - 32px));
      padding: 24px;
    }
    h2 {
      margin: 0;
      font-size: 1.125rem;
    }
    p {
      margin: 0;
      line-height: 1.45;
    }
    .eyebrow {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--oh-primary);
    }
    .doit {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--oh-text-muted);
    }
    .more {
      font-weight: 600;
      margin-top: 4px;
    }
    .extras {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }
    .spacer {
      flex: 1;
    }
    .skip {
      justify-self: start;
      padding: 6px 0;
      border: 0;
      background: none;
      color: var(--oh-text-muted);
      font: inherit;
      font-size: 0.8125rem;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class TourOverlayComponent {
  protected readonly tutorial = inject(TutorialService);
  private readonly document = inject(DOCUMENT);
  private readonly layer = viewChild.required<ElementRef<HTMLElement>>('layer');
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  protected readonly spot = signal<Rect | null>(null);
  /** Hay una ventana abierta que no es parte del paso: la tarjeta se esconde para no taparla */
  protected readonly hidden = signal(false);
  private readonly cardSize = signal({ width: 380, height: 200 });
  /** Celular con algo más alto que media pantalla resaltado: tarjeta compacta */
  protected readonly tight = computed(() => {
    const r = this.spot();
    const view = this.document.defaultView!;
    return view.innerWidth < 600 && !!r && r.height > view.innerHeight / 2;
  });
  protected readonly expanded = signal(false);
  private readonly visible = computed(() => !!this.tutorial.invite() || this.tutorial.running());

  /**
   * Debajo del elemento si cabe; si no, arriba; si no (algo alto, como una ventana), al lado
   * con la tarjeta más angosta; y si tampoco, arriba de la pantalla, así no tapa los botones
   * de guardar que van al final de los formularios.
   */
  protected readonly cardPos = computed<{ top: number; left: number; width?: number }>(() => {
    const view = this.document.defaultView!;
    const vw = view.innerWidth;
    const vh = view.innerHeight;
    const { width, height } = this.cardSize();
    const r = this.spot();
    if (!r) return { top: Math.max(GAP, (vh - height) / 2), left: Math.max(GAP, (vw - width) / 2) };
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - width / 2), vw - width - GAP);
    const below = r.top + r.height + GAP;
    if (below + height <= vh - GAP) return { top: below, left };
    if (r.top - height - GAP >= GAP) return { top: r.top - height - GAP, left };
    const sideTop = Math.max(GAP, Math.min(r.top, vh - height - GAP));
    const right = vw - (r.left + r.width) - GAP * 2;
    const leftSpace = r.left - GAP * 2;
    if (Math.max(right, leftSpace) >= SIDE_MIN) {
      const w = Math.min(380, Math.max(right, leftSpace));
      return right >= leftSpace
        ? { top: sideTop, left: r.left + r.width + GAP, width: w }
        : { top: sideTop, left: r.left - GAP - w, width: w };
    }
    return { top: GAP, left };
  });

  private frame = 0;
  private lastPoll = 0;
  private openDialogs = 0;
  private scrolledFor: unknown = null;

  constructor() {
    // Cada paso empieza con la explicación recogida (en la tarjeta compacta)
    effect(() => {
      this.tutorial.step();
      this.expanded.set(false);
    });
    effect(() => {
      const layer = this.layer().nativeElement;
      const visible = this.visible();
      if (visible && !layer.matches(':popover-open')) layer.showPopover();
      if (!visible && layer.matches(':popover-open')) layer.hidePopover();
      cancelAnimationFrame(this.frame);
      if (this.tutorial.running()) this.frame = requestAnimationFrame((t) => this.tick(t));
      else this.spot.set(null);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  protected inviteTitle(id: string): TranslationKey {
    return `tutorial.invite.${id as 'lists' | 'account' | 'calendar' | 'finance'}`;
  }

  protected runExtra(extra: TourExtra): void {
    this.tutorial.runExtra(extra);
  }

  /** Cada cuadro: sigue al elemento del paso, revisa si ya se hizo lo pedido y mantiene la capa arriba */
  private tick(time: number): void {
    const step = this.tutorial.step();
    const found = step?.target ? this.findTarget(step.target) : null;
    const dialogOpen = !!this.document.querySelector('dialog[open]');
    // Con una ventana abierta solo se muestra el paso si lo que señala está dentro de ella
    const hide = !!step && dialogOpen && !found?.closest('dialog[open]');
    if (hide !== this.hidden()) this.hidden.set(hide);
    const target = hide ? null : found;
    if (target) {
      if (this.scrolledFor !== step) {
        this.scrolledFor = step;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      const r = target.getBoundingClientRect();
      const next = {
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      };
      const prev = this.spot();
      if (
        !prev ||
        Math.abs(prev.top - next.top) +
          Math.abs(prev.left - next.left) +
          Math.abs(prev.width - next.width) +
          Math.abs(prev.height - next.height) >
          0.5
      ) {
        this.spot.set(next);
      }
    } else if (this.spot()) {
      this.spot.set(null);
    }

    const card = this.card()?.nativeElement;
    if (
      card &&
      (card.offsetWidth !== this.cardSize().width || card.offsetHeight !== this.cardSize().height)
    ) {
      this.cardSize.set({ width: card.offsetWidth, height: card.offsetHeight });
    }

    // Una ventana nueva queda encima: se vuelve a subir la capa
    const dialogs = this.document.querySelectorAll('dialog[open]').length;
    if (dialogs !== this.openDialogs) {
      this.openDialogs = dialogs;
      const layer = this.layer().nativeElement;
      if (layer.matches(':popover-open')) {
        layer.hidePopover();
        layer.showPopover();
      }
    }

    if (time - this.lastPoll > POLL_MS) {
      this.lastPoll = time;
      if (step?.until?.()) this.tutorial.next();
    }
    if (this.tutorial.running()) this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  /** El primero que se ve (en celular y escritorio puede haber dos versiones del mismo botón) */
  private findTarget(selector: string): HTMLElement | null {
    const all = Array.from(this.document.querySelectorAll<HTMLElement>(selector));
    return all.find((el) => el.offsetParent !== null || el.getClientRects().length > 0) ?? null;
  }
}
