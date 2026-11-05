// Bundles the on-page panel into one self-contained script for a javascript: bookmark.
import { buildSync } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @returns {{ code: string, inputs: string[] }} */
export function buildBookmarklet(siteUrl) {
  const result = buildSync({
    entryPoints: [resolve(here, '../src/panel/entry.ts')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    metafile: true,
    target: 'es2020',
    legalComments: 'none',
    define: { __SITE_URL__: JSON.stringify(siteUrl) },
  });
  const code = result.outputFiles[0].text.trim();
  const inputs = Object.keys(result.metafile.inputs).map((f) => resolve(process.cwd(), f));
  return { code, inputs };
}
