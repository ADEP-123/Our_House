import { DestroyRef, ElementRef, WritableSignal, effect, inject } from '@angular/core';

/**
 * Mantiene en `height` el alto del elemento, que cambia con el ancho de la pantalla o el contenido.
 * Se llama en el constructor de un componente.
 */
export function watchHeight(
  el: () => ElementRef<HTMLElement> | undefined,
  height: WritableSignal<number>,
): void {
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(([entry]) =>
    height.set(Math.round(entry!.borderBoxSize?.[0]?.blockSize ?? entry!.contentRect.height)),
  );
  effect(() => {
    const node = el()?.nativeElement;
    observer.disconnect();
    if (node) observer.observe(node);
  });
  inject(DestroyRef).onDestroy(() => observer.disconnect());
}
