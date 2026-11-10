import { DOCUMENT, DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { dueInfo } from '../lists/item-logic';
import { MyTask } from '../lists/lists.models';
import { ListsStore } from '../lists/lists.store';

const APP_NAME = 'Our House';
const EVERY_MS = 2 * 60_000;

/** Mis tareas vencidas y sin hacer */
export function countOverdue(
  tasks: Pick<MyTask, 'dueDate' | 'dueAt' | 'completedAt'>[],
  now = new Date(),
): number {
  return tasks.filter((t) => !t.completedAt && dueInfo(t, now)?.kind === 'overdue').length;
}

/** "(3) Our House" */
export const titleWith = (overdue: number) => (overdue > 0 ? `(${overdue}) ${APP_NAME}` : APP_NAME);

/**
 * Cuántas tareas mías están vencidas, a la vista sin abrir la app:
 * en el título de la pestaña y en el globito del ícono de la app instalada (donde el sistema lo permite).
 */
@Injectable({ providedIn: 'root' })
export class OverdueBadgeService {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly store = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private timer?: ReturnType<typeof setInterval>;

  start(): void {
    const refresh = () => {
      if (this.auth.user() && this.document.visibilityState === 'visible') void this.refresh();
    };
    effect(() => {
      const user = this.auth.user();
      untracked(() => (user ? void this.refresh() : this.show(0)));
    });
    // Al terminar de enviar lo hecho sin conexión, al cambiar de pantalla y cada 2 minutos
    effect(() => {
      if (this.store.synced() > 0) untracked(refresh);
    });
    const nav = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(refresh);
    this.timer = setInterval(refresh, EVERY_MS);
    this.document.addEventListener('visibilitychange', refresh);
    this.destroyRef.onDestroy(() => {
      nav.unsubscribe();
      clearInterval(this.timer);
      this.document.removeEventListener('visibilitychange', refresh);
    });
  }

  async refresh(): Promise<void> {
    try {
      this.show(countOverdue(await this.store.myTasks()));
    } catch {
      // Sin conexión ni copia guardada: queda lo último que se mostró
    }
  }

  private show(overdue: number): void {
    this.document.title = titleWith(overdue);
    const nav = this.document.defaultView?.navigator as
      | (Navigator & { setAppBadge?(n: number): Promise<void>; clearAppBadge?(): Promise<void> })
      | undefined;
    if (!nav?.setAppBadge) return;
    void (overdue > 0 ? nav.setAppBadge(overdue) : nav.clearAppBadge!()).catch(() => undefined);
  }
}
