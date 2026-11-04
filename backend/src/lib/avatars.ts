/** Avatares predefinidos (el frontend los dibuja). Se guardan por id, no como imagen. */
export const USER_AVATAR_PRESETS = [
  'fox', 'cat', 'dog', 'panda', 'owl', 'frog', 'bear', 'rabbit', 'koala', 'penguin', 'turtle', 'bee',
] as const;

export const FAMILY_AVATAR_PRESETS = [
  'house', 'cottage', 'tree', 'sunflower', 'clover', 'star', 'moon', 'sun', 'wave', 'mountain', 'orange', 'balloon',
] as const;

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const SIGNATURES: { type: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { type: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/** Identifica la imagen por sus primeros bytes: no se confía en el Content-Type que manda el navegador. */
export const detectImage = (data: Buffer) => SIGNATURES.find((s) => s.test(data)) ?? null;
