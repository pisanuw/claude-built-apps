import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM/worker layer is exercised by hand in the browser, not by unit
      // tests; libs.ts is a generated table of raw imports with no logic.
      exclude: ['src/main.ts', 'src/ui/**', 'src/worker.ts', 'src/core/libs.ts', 'src/**/*.d.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
