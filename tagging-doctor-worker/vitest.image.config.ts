import { defineConfig } from 'vitest/config';

// The tests that need the built image and a Docker daemon (AC-31, AC-33, AC-34, AC-36, AC-64, AC-82).
// Since CR-13 they run against the hub's image, with the checker mounted (the default):
//   docker build -f backend-hub/Dockerfile -t backend-hub:dev .   (from the repository's root)
//   npm run test:image
// WORKER_IMAGE=tagging-doctor-worker:dev runs them against the worker's own image (docker build -t tagging-doctor-worker:dev .).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/image/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
