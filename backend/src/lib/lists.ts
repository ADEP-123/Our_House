/** Valores permitidos para tipo, color e ícono (el frontend decide cómo se ven). */
export const LIST_TYPES = ['todo', 'shopping', 'other', 'secret'] as const;
export const LIST_COLORS = ['blue', 'green', 'teal', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray'] as const;
/** Íconos con nombre (los primeros que tuvo la app); los demás se guardan como el emoji mismo */
export const LIST_ICONS = [
  'check', 'cart', 'home', 'broom', 'gift', 'plane', 'book', 'heart', 'star', 'tool', 'food', 'paw', 'lock', 'key',
] as const;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Un solo emoji (con sus variantes: tono de piel, banderas, combinaciones con ZWJ) */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 16) return false;
  if ([...segmenter.segment(value)].length !== 1) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u.test(value) && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200D\uFE0F\u20E3]+$/u.test(value);
}

export const isListIcon = (value: string) => (LIST_ICONS as readonly string[]).includes(value) || isSingleEmoji(value);

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
