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
      // main.ts only mounts the app. frame.ts renders a page in an iframe and
      // needs a real layout engine; it is checked in a real browser, and the
      // parts it calls (prepareHtml, scanFromAxe) are unit tested.
      exclude: ['src/main.ts', 'src/ui/frame.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
