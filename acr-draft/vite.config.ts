import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // axe-core (scanner) and docx (Word export) load only when used.
    chunkSizeWarningLimit: 700,
  },
});
