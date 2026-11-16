// Bundles the server code into self-contained files the deploy runner hands
// to Netlify (netlify/functions):
// - api.mjs: the routes at /api/* (src/server/netlify.ts);
// - canary-run/: the Scheduled Function (milestone 5). canary-run.mjs is a
//   small hand-written wrapper so its `config.schedule` is a plain literal
//   Netlify can read; job.mjs is the bundled job (src/server/scheduled.ts).
// The public Supabase URL and anon key (the same VITE_* values as the page)
// are baked in; secrets are read from the environment at run time only.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const functions = resolve(root, 'netlify/functions');
/** Every JOB_EVERY_MIN (src/core/schedule.ts) minutes. */
export const SCHEDULE = '*/10 * * * *';

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.VITE_SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? ''),
  },
};

const api = resolve(functions, 'api.mjs');
mkdirSync(dirname(api), { recursive: true });
await build({ ...common, entryPoints: [resolve(root, 'src/server/netlify.ts')], outfile: api });
console.log(`Built ${api}`);

const runDir = resolve(functions, 'canary-run');
mkdirSync(runDir, { recursive: true });
await build({ ...common, entryPoints: [resolve(root, 'src/server/scheduled.ts')], outfile: resolve(runDir, 'job.mjs') });
writeFileSync(
  resolve(runDir, 'canary-run.mjs'),
  `// Delivery Canary's scheduled run (built by scripts/build-function.mjs).\nimport run from './job.mjs';\n\nexport default run;\n\nexport const config = { schedule: '${SCHEDULE}' };\n`,
);
console.log(`Built ${runDir}`);
