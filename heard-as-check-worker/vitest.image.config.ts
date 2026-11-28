import { defineConfig } from 'vitest/config';

// The tests that need the hub's image and a Docker daemon (AC-2, AC-12, AC-14, AC-15, AC-17, AC-18, AC-20 to AC-24).
// From the repository's root:
//   docker build -f backend-hub/Dockerfile -t backend-hub:dev .
//   (cd heard-as-check && npm run fixtures)
//   npm run test:image      (here; SECCOMP=<profile> names the seccomp profile Chromium's sandbox needs under Docker, D-15)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/image/**/*.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
