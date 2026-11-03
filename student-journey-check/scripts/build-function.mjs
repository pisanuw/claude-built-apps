// Bundles the checker's server endpoint into one self-contained file that the
// deploy runner hands to Netlify as the `api` function (netlify/functions).
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
  // Lets bundled CommonJS code call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log(`Built ${outfile}`);
