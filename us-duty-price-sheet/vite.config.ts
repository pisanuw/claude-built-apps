import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // The bundled US tariff data (src/data/hts.json) is its own lazily loaded chunk of about 2 MB (140 KB gzipped).
    chunkSizeWarningLimit: 2500,
  },
});
