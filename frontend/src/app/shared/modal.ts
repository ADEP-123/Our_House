/**
 * Abre un diálogo como ventana modal. Durante la práctica de un tutorial se abre sin el modo
 * modal del navegador: un diálogo modal vuelve inerte todo lo demás, también la tarjeta del
 * tutorial (aunque esté encima), y no se podría tocar. Se ve igual gracias a la clase oh-dialog-tour.
 */
export function openModal(el: HTMLDialogElement): void {
  if (el.open) return;
  const tour = document.body.classList.contains('oh-practice');
  el.classList.toggle('oh-dialog-tour', tour);
  if (tour) el.show();
  else el.showModal();
}
