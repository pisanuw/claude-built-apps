import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM layer and the Pyodide worker are exercised by hand in the browser, not by unit tests.
      exclude: ['src/main.ts', 'src/**/*.d.ts', 'src/ui/**', 'src/worker/**'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
