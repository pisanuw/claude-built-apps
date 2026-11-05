import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildBookmarklet } from './scripts/bookmarklet.mjs';

const SITE_URL = process.env.POPUP_CHECK_SITE_URL ?? 'https://popup-check.pisan.me/';

/** Bundles src/panel/entry.ts into one script and exposes it as `virtual:bookmarklet`. */
function bookmarklet(): Plugin {
  const id = 'virtual:bookmarklet';
  return {
    name: 'popup-check-bookmarklet',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(loadId) {
      if (loadId !== `\0${id}`) return null;
      const { code, inputs } = buildBookmarklet(SITE_URL);
      for (const f of inputs) this.addWatchFile(f);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [bookmarklet()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        practice: resolve(import.meta.dirname, 'practice.html'),
      },
    },
  },
});
