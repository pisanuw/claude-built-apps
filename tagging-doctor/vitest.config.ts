import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Pages show dates in the person's zone (R2.1-8); the tests read them in UTC.
    env: { TZ: 'UTC' },
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // main.ts only mounts the app; the UI is tested under jsdom in test/.
      exclude: ['src/main.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
