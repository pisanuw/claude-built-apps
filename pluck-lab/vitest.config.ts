import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM and Web Audio glue is exercised in a real browser, not by unit
      // tests; the Engine it wraps is covered here.
      exclude: ['src/main.ts', 'src/ui/**', 'src/audio/**', 'src/**/*.d.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
