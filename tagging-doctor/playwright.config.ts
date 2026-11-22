import { defineConfig } from '@playwright/test';

// The walkthrough runs against `vite preview` built without Supabase env, so
// the app uses the in-memory repository and nothing reaches the network.
// Its own port (E2E_PORT, default 4391), and never a server already running
// there: two sessions on one port would test each other's build (review
// m2 r1). A taken port fails the run instead.
const port = Number(process.env.E2E_PORT ?? 4391);
// Compile and check (milestone 3b) is built on, with a stand-in checker
// address that no network answers: the walkthrough answers its routes itself
// (page.route), so nothing reaches a real checker (AC-59's stub).
export const CHECKER_STUB = 'https://checker.e2e.invalid';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...(process.env as Record<string, string>), VITE_CHECKER_URL: CHECKER_STUB, VITE_COMPILE_CHECK: 'on' },
  },
});
