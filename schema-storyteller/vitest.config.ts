import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // main.ts is the DOM entry point; it is exercised by hand, not by unit tests.
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
