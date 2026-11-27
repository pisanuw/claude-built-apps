import { defineConfig } from '@playwright/test';

// Two builds:
// - the walkthrough runs against `vite preview` built without Supabase values,
//   so the page is in preview mode and reaches no network;
// - AC-6's request recording (e2e/hosts.spec.ts) runs against a build with
//   the production values of deploy/target.yml, every request recorded and the
//   outside ones answered by stubs.
const LIVE_ENV = [
  'VITE_SUPABASE_URL=https://auth.hintwise.org',
  `VITE_SUPABASE_ANON_KEY=${process.env.HAC_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFya3R4bHJseWNlZmZ5b3pkd2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODEwMTAsImV4cCI6MjA5MjQ1NzAxMH0.Vuku-irT3kAHZYibK23q6dpyOEqV_Eg5zB78I3dyshE'}`,
  'VITE_CHECK_URL=https://backend-hub-wk2e.onrender.com/heard-as-check',
].join(' ');

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  projects: [
    { name: 'preview', testIgnore: /hosts\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
    { name: 'live-build', testMatch: /hosts\.spec\.ts/, use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `env ${LIVE_ENV} npx vite build --outDir dist-live && npx vite preview --outDir dist-live --port 4174 --strictPort`,
      url: 'http://localhost:4174',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
