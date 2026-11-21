import { defineConfig } from 'vitest/config';

// The tests that need the built image and a Docker daemon (AC-31, AC-33, AC-34, AC-36, AC-64):
//   docker build -t tagging-doctor-worker . && npm run test:image
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/image/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
