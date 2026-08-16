import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Node environment (the store uses node:sqlite server-side). The `@/` alias
// mirrors tsconfig `paths` so tests resolve app-style imports.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
