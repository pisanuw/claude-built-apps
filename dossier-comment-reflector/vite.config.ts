import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // docx (Word export) loads only when the user downloads.
    chunkSizeWarningLimit: 700,
  },
});
