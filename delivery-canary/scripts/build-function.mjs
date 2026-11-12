// Bundles the server routes into one self-contained file that the deploy
// runner hands to Netlify as the `api` function (netlify/functions). The
// public Supabase URL and anon key (the same VITE_* values as the page) are
// baked in; the function holds no secret.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'netlify/functions/api.mjs');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/server/netlify.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.VITE_SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? ''),
  },
});
console.log(`Built ${outfile}`);
