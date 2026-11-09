import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // The gateway's pure modules (src/gateway) and the report formatter
      // (src/report/format.mjs). The Deno entry point and the app template are
      // outside src and are not measured here.
      include: ['src/**/*.ts', 'src/**/*.mjs'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
