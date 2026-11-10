/** Temas de la paleta (deben coincidir con frontend/src/app/core/theme/themes.ts) */
export const CLASSIC_PRESETS = ['claro', 'oscuro', 'bosque', 'oceano', 'lavanda'] as const;
export const SEASONAL_PRESETS = ['primavera', 'verano', 'otono', 'invierno', 'navidad', 'halloween', 'amor', 'anionuevo'] as const;

/** Todos los temas que se pueden guardar: clásicos, de temporada en claro y oscuro, o personalizado */
export const THEME_PRESETS = [...CLASSIC_PRESETS, ...SEASONAL_PRESETS, ...SEASONAL_PRESETS.map((id) => `${id}-oscuro` as const), 'custom'] as const;
