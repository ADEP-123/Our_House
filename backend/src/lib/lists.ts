/** Valores permitidos para tipo, color e ícono (el frontend decide cómo se ven). */
export const LIST_TYPES = ['todo', 'shopping', 'other'] as const;
export const LIST_COLORS = ['blue', 'green', 'teal', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray'] as const;
export const LIST_ICONS = [
  'check', 'cart', 'home', 'broom', 'gift', 'plane', 'book', 'heart', 'star', 'tool', 'food', 'paw',
] as const;

export type ListType = (typeof LIST_TYPES)[number];
