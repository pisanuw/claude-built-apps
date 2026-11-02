import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Process the stylesheet (vitest blanks CSS by default) so test/styles.test.ts can read it raw.
    css: { include: [/styles\.css/] },
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM layer is exercised by hand in the browser, not by unit tests.
      exclude: ['src/main.ts', 'src/ui/**'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
