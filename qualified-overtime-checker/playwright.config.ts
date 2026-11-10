import { defineConfig } from '@playwright/test';

// No @types/node here; Playwright runs this file under Node.
declare const process: { env: Record<string, string | undefined> };

// The walkthrough runs against `vite preview` built without Supabase env, so
// the app uses the in-memory repository and nothing reaches the network.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // PW_CHROMIUM points at a preinstalled Chromium when the bundled one is missing (cloud sessions).
  use: { baseURL: 'http://localhost:4173', launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
