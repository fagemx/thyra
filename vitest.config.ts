import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['src/test-utils/bun-globals-shim.ts'],
  },
  resolve: {
    alias: {
      'bun:sqlite': path.resolve(__dirname, 'src/test-utils/bun-sqlite-shim.ts'),
    },
  },
});
