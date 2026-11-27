import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps the build portable: works at the domain root (Netlify)
// and under a subpath (GitHub Pages project sites) without configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Vitest runs the switch's test (tests/theme.test.js); the colour engine's tests stay on node --test (*.test.mjs).
  test: { include: ['tests/**/*.test.js'] },
});
