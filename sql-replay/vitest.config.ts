import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // The DOM layer (editor panes, stepper, clipboard) is exercised by hand
      // in the browser; everything the replay shows is computed in src/core
      // and tested here.
      exclude: ['src/main.ts', 'src/ui/**', 'src/**/*.d.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
