import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Todas las pruebas comparten la base de pruebas: se ejecutan una tras otra
    fileParallelism: false,
  },
});
