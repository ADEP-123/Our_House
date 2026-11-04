import { ListItem } from './lists.models';

/**
 * Reglas de los ítems que la pantalla aplica al instante y que la copia sin conexión repite.
 * Son las mismas que aplica el servidor, así lo que se ve coincide al sincronizar.
 */

type Who = { id: string; nickname: string | null } | null;

/** Suma una compra. amount null = lo que faltaba (o el ítem entero si no tiene cantidad). */
export function applyPurchase(item: ListItem, amount: number | null, spent: number | null, who: Who, now = new Date()): ListItem {
  const purchased = item.amount === null ? 1 : (item.purchased ?? 0) + (amount ?? Math.max(item.amount - (item.purchased ?? 0), 0));
  const complete = item.amount === null || purchased >= item.amount;
  return {
    ...item,
    purchased,
    spent: spent === null ? item.spent : round2((item.spent ?? 0) + spent),
    completedAt: complete ? (item.completedAt ?? now.toISOString()) : null,
    completedBy: complete ? (item.completedBy ?? who) : null,
  };
}

/** Marcar = comprado todo; desmarcar = borra lo comprado y lo pagado. */
export function applyCompleted(item: ListItem, completed: boolean, who: Who, now = new Date()): ListItem {
  if (!completed) return { ...item, completedAt: null, completedBy: null, purchased: null, spent: null };
  return {
    ...item,
    completedAt: item.completedAt ?? now.toISOString(),
    completedBy: item.completedBy ?? who,
    purchased: item.amount !== null ? Math.max(item.purchased ?? 0, item.amount) : item.purchased,
  };
}

// ---------- Subtareas ----------

/** La tarea sigue a sus subtareas: completa si todas lo están, pendiente si alguna no. */
export function syncParent(items: ListItem[], parentId: string | null, who: Who, now = new Date()): ListItem[] {
  if (!parentId) return items;
  const subs = items.filter((i) => i.parentId === parentId);
  if (!subs.length) return items;
  const allDone = subs.every((s) => s.completedAt);
  return items.map((i) => {
    if (i.id !== parentId) return i;
    if (allDone && !i.completedAt) return { ...i, completedAt: now.toISOString(), completedBy: who };
    if (!allDone && i.completedAt) return { ...i, completedAt: null, completedBy: null };
    return i;
  });
}

/** Marcar o desmarcar dentro de la lista: completar una tarea completa sus subtareas; una subtarea arrastra a su tarea. */
export function applyToggle(items: ListItem[], itemId: string, completed: boolean, who: Who, now = new Date()): ListItem[] {
  const target = items.find((i) => i.id === itemId);
  if (!target) return items;
  let next = items.map((i) => (i.id === itemId ? applyCompleted(i, completed, who, now) : i));
  if (completed && !target.parentId) {
    next = next.map((i) => (i.parentId === itemId && !i.completedAt ? { ...i, completedAt: now.toISOString(), completedBy: who } : i));
  }
  return syncParent(next, target.parentId, who, now);
}

/** Quita un ítem (y sus subtareas) y actualiza su tarea si era subtarea. */
export function removeItem(items: ListItem[], itemId: string, who: Who, now = new Date()): ListItem[] {
  const target = items.find((i) => i.id === itemId);
  const next = items.filter((i) => i.id !== itemId && i.parentId !== itemId);
  return syncParent(next, target?.parentId ?? null, who, now);
}

/** Comprado algo, pero no todo lo pedido */
export const isPartial = (item: ListItem): boolean => !item.completedAt && item.purchased !== null && item.amount !== null;

/** Lo que falta por comprar (null si el ítem no tiene cantidad) */
export const remaining = (item: ListItem): number | null =>
  item.amount === null ? null : Math.max(round3(item.amount - (item.purchased ?? 0)), 0);

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function formatAmount(n: number, locale: string): string {
  return n.toLocaleString(locale, { maximumFractionDigits: 3 });
}

export function formatMoney(n: number, currency: string, locale: string): string {
  try {
    return n.toLocaleString(locale, { style: 'currency', currency });
  } catch {
    return `${n.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** Unidades sugeridas al escribir una cantidad (se puede escribir cualquier otra) */
export const unitsFor = (locale: string): string[] =>
  locale.startsWith('en')
    ? ['pcs', 'kg', 'g', 'lb', 'oz', 'L', 'ml', 'pack', 'dozen', 'can', 'bottle', 'box']
    : ['unid.', 'kg', 'g', 'L', 'ml', 'paquete', 'docena', 'lata', 'botella', 'caja'];
