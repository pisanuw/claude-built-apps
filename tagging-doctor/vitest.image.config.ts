import { defineConfig } from 'vitest/config';

// The tests of milestone 4 that need the checker's image and a Docker daemon (AC-40's swap records,
// AC-42, AC-43, AC-67): they run the app's patch and compare code against the real worker.
//   docker build -t tagging-doctor-worker:dev ../tagging-doctor-worker && npm run test:image
// WORKER_IMAGE names another tag; CPUS the plan's CPU (0.5, backend-hub's; SPEC question 5).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['image-test/**/*.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
