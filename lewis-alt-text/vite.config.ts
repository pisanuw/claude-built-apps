import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      // The app, and /terminal/ (sign-in for the command-line tool).
      input: { main: 'index.html', terminal: 'terminal/index.html' },
    },
  },
});
