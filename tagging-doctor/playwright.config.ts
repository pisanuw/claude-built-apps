import { defineConfig } from '@playwright/test';

// The walkthrough runs against `vite preview` built without Supabase env, so
// the app uses the in-memory repository and nothing reaches the network.
// Its own port (E2E_PORT, default 4391), and never a server already running
// there: two sessions on one port would test each other's build (review
// m2 r1). A taken port fails the run instead.
const port = Number(process.env.E2E_PORT ?? 4391);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
