import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // main.ts only mounts the app; the UI is tested under jsdom in test/.
      // cli/run.ts and cli/bundle.ts only wire the CLI; test/cli/bundle.test.ts runs them in a child process.
      exclude: ['src/main.ts', 'src/cli/run.ts', 'src/cli/bundle.ts', 'src/**/*.d.ts'],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
