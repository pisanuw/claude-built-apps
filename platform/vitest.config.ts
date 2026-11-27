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
      // outside src and are not measured here. hw-theme.js, the browser script
      // apps copy, is measured too (test/theme-toggle.test.ts imports it);
      // theme-init.js runs in node:vm, so it is tested but not measured.
      include: ['src/**/*.ts', 'src/**/*.mjs', 'src/theme/hw-theme.js'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
