/** Valores permitidos para tipo, color e ícono (el frontend decide cómo se ven). */
export const LIST_TYPES = ['todo', 'shopping', 'other', 'secret'] as const;
export const LIST_COLORS = ['blue', 'green', 'teal', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray'] as const;
export const LIST_ICONS = [
  'check', 'cart', 'home', 'broom', 'gift', 'plane', 'book', 'heart', 'star', 'tool', 'food', 'paw', 'lock', 'key',
] as const;

export type ListType = (typeof LIST_TYPES)[number];

/** Opciones que se pueden activar en los elementos de una lista */
export const LIST_FEATURES = ['quantity', 'category', 'purchases', 'assignee', 'due', 'subtasks', 'repeat'] as const;
export type ListFeature = (typeof LIST_FEATURES)[number];

/** Opciones con que nace cada tipo si no se eligen otras */
export const DEFAULT_FEATURES: Record<ListType, ListFeature[]> = {
  shopping: ['quantity', 'category', 'purchases', 'repeat'],
  todo: ['assignee', 'due', 'subtasks', 'repeat'],
  other: [],
  secret: [],
};

/** Tipos de campo de un elemento secreto (el frontend decide cómo se muestran) */
export const SECRET_FIELD_KINDS = ['text', 'username', 'password', 'url', 'pin', 'note'] as const;
