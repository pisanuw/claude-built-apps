import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM glue is exercised in a real browser, not by unit tests; the
      // simulator, fault model and diagnosis it drives are covered here.
      exclude: ['src/main.ts', 'src/ui/**'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
