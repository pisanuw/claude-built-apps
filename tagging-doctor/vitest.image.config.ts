import { defineConfig } from 'vitest/config';

// The tests of milestone 4 that need the checker's image and a Docker daemon (AC-40's swap records,
// AC-42, AC-43, AC-67): they run the app's patch and compare code against the real checker,
// mounted in the hub's image (CR-13):
//   (from the repository's root) docker build -f backend-hub/Dockerfile -t backend-hub:dev .
//   npm run test:image
// WORKER_IMAGE names another tag (tagging-doctor-worker:dev, the worker alone); CPUS the CPU (0.5, the hub's).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['image-test/**/*.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
