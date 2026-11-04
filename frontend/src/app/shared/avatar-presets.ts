/** Avatares predefinidos: el id se guarda en la base; aquí se decide cómo se ven. */
export interface AvatarPreset {
  id: string;
  emoji: string;
  /** Color de fondo del círculo */
  tint: string;
}

export const USER_AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'fox', emoji: '🦊', tint: '#fde3cf' },
  { id: 'cat', emoji: '🐱', tint: '#fbe7b5' },
  { id: 'dog', emoji: '🐶', tint: '#eadcc8' },
  { id: 'panda', emoji: '🐼', tint: '#e3e7ee' },
  { id: 'owl', emoji: '🦉', tint: '#e8dccf' },
  { id: 'frog', emoji: '🐸', tint: '#d6efd0' },
  { id: 'bear', emoji: '🐻', tint: '#ecd9c6' },
  { id: 'rabbit', emoji: '🐰', tint: '#f6dbe6' },
  { id: 'koala', emoji: '🐨', tint: '#dde3ea' },
  { id: 'penguin', emoji: '🐧', tint: '#d7e6f5' },
  { id: 'turtle', emoji: '🐢', tint: '#d8eedf' },
  { id: 'bee', emoji: '🐝', tint: '#fbefb3' },
];

export const FAMILY_AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'house', emoji: '🏠', tint: '#dbe6f5' },
  { id: 'cottage', emoji: '🏡', tint: '#d8ecd6' },
  { id: 'tree', emoji: '🌳', tint: '#d4ead8' },
  { id: 'sunflower', emoji: '🌻', tint: '#fbefc0' },
  { id: 'clover', emoji: '🍀', tint: '#d9f0d4' },
  { id: 'star', emoji: '⭐', tint: '#fbf0c6' },
  { id: 'moon', emoji: '🌙', tint: '#e2e1f3' },
  { id: 'sun', emoji: '☀️', tint: '#fde9c4' },
  { id: 'wave', emoji: '🌊', tint: '#d4e9f3' },
  { id: 'mountain', emoji: '🏔️', tint: '#e2e7ee' },
  { id: 'orange', emoji: '🍊', tint: '#fde1c8' },
  { id: 'balloon', emoji: '🎈', tint: '#f8dcdc' },
];

export const findPreset = (id: string | null | undefined, list: AvatarPreset[] = USER_AVATAR_PRESETS) =>
  list.find((p) => p.id === id) ?? null;
