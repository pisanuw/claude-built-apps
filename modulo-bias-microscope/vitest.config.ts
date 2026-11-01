import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM glue and the worker shim are exercised in a real browser; the
      // enumerator, statistics, grader and job runner they drive are covered here.
      exclude: ['src/main.ts', 'src/worker.ts', 'src/ui/**'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
