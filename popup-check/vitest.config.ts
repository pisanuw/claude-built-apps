import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // Entry files only mount the app; panel-css and env.d.ts hold no logic.
      exclude: ['src/main.ts', 'src/practice-main.ts', 'src/panel/entry.ts', 'src/env.d.ts', 'src/panel/panel-css.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
