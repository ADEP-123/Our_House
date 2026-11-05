import type { TranslationKey } from '../../core/i18n/i18n.service';

export type ListType = 'todo' | 'shopping' | 'other';

/** Opciones de los elementos de una lista (se pueden mezclar en cualquier tipo) */
export type ListFeature = 'quantity' | 'category' | 'purchases' | 'assignee' | 'due' | 'subtasks';

export const LIST_FEATURES: { id: ListFeature; label: TranslationKey; hint: TranslationKey }[] = [
  { id: 'quantity', label: 'lists.features.quantity', hint: 'lists.features.quantityHint' },
  { id: 'category', label: 'lists.features.category', hint: 'lists.features.categoryHint' },
  { id: 'purchases', label: 'lists.features.purchases', hint: 'lists.features.purchasesHint' },
  { id: 'assignee', label: 'lists.features.assignee', hint: 'lists.features.assigneeHint' },
  { id: 'due', label: 'lists.features.due', hint: 'lists.features.dueHint' },
  { id: 'subtasks', label: 'lists.features.subtasks', hint: 'lists.features.subtasksHint' },
];

/** Con qué opciones nace cada tipo: son solo un punto de partida */
export const DEFAULT_FEATURES: Record<ListType, ListFeature[]> = {
  shopping: ['quantity', 'category', 'purchases'],
  todo: ['assignee', 'due', 'subtasks'],
  other: [],
};

export const LIST_TYPES: { id: ListType; label: TranslationKey; defaultIcon: string }[] = [
  { id: 'todo', label: 'lists.types.todo', defaultIcon: 'check' },
  { id: 'shopping', label: 'lists.types.shopping', defaultIcon: 'cart' },
  { id: 'other', label: 'lists.types.other', defaultIcon: 'star' },
];

/** Tonos medios: se leen sobre fondos claros y oscuros. Los fondos suaves se derivan con color-mix. */
export const LIST_COLORS: Record<string, string> = {
  blue: '#3f6fc2',
  green: '#3f8f5a',
  teal: '#1f8a8a',
  purple: '#7b5cc4',
  pink: '#c4558f',
  red: '#c44b4b',
  orange: '#d9822b',
  yellow: '#c9a227',
  gray: '#6b7280',
};

export const LIST_ICONS: Record<string, string> = {
  check: '✅',
  cart: '🛒',
  home: '🏠',
  broom: '🧹',
  gift: '🎁',
  plane: '✈️',
  book: '📚',
  heart: '❤️',
  star: '⭐',
  tool: '🔧',
  food: '🍽️',
  paw: '🐾',
};

export const colorOf = (id: string) => LIST_COLORS[id] ?? LIST_COLORS['blue']!;
export const iconOf = (id: string) => LIST_ICONS[id] ?? LIST_ICONS['check']!;
