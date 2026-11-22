// Bundles the command-line tool into one self-contained file that the app
// offers for download on /terminal/: dist/cli/lewis-alt-text.mjs (or the path
// given as the first argument). The skill and the public sign-in settings are
// built in, so the file needs nothing beside it and no npm install.
//
// The file has no import or export statements. Its banner gives the bundle a
// `require` made from process.getBuiltinModule, so Node runs it whether it
// treats the file as an ES module or as CommonJS, which depends on the name
// the downloaded file ends up with (.mjs, .js, .txt, none). On a Node too old
// for that, the banner prints what to install instead of a stack trace. The
// output is not minified, so anyone can read what they are running.
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'cli', 'lewis-alt-text.mjs'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = `${pkg.version} (built ${new Date().toISOString().slice(0, 10)})`;
// The same address as INSTRUCTIONS_URL in src/core/remote.ts (test/cli/bundle.test.ts checks).
const instructions = 'https://github.com/pisanuw/claude-built-apps/blob/main/lewis-alt-text/cli/INSTRUCTIONS.md';

// ES5 only, so that even a very old Node can parse it and print the message.
const banner = `#!/usr/bin/env node
// Lewis Structure Alt Text: the command-line tool, version ${version}.
// One self-contained file. Run it with Node.js:  node lewis-alt-text.mjs --help
// How to use it: ${instructions}
// Source: https://github.com/pisanuw/claude-built-apps/tree/main/lewis-alt-text
var require = (function () {
  var p = typeof process === "object" && process ? process : null;
  if (p && typeof p.getBuiltinModule === "function") {
    return function (id) { return p.getBuiltinModule(id); };
  }
  var has = p && p.version ? "Node.js " + p.version : "an old Node.js";
  var msg = "lewis-alt-text needs a newer Node.js: this computer has " + has + ".\\n" +
    "Install the LTS version from https://nodejs.org (it is free), then run the same command again.";
  if (typeof console === "object") console.error(msg);
  if (p) p.exit(1);
  throw new Error(msg);
})();`;

await build({
  entryPoints: [path.join(root, 'src', 'cli', 'bundle.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Old enough syntax that Node 14 and later parse the whole file, so they reach the banner's message.
  target: 'node14',
  banner: { js: banner },
  define: { __VERSION__: JSON.stringify(version) },
  loader: { '.txt': 'text', '.yml': 'text' },
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(outfile, 0o755);
const shown = path.relative(process.cwd(), outfile);
console.log(`built ${shown.startsWith('..') ? outfile : shown} (${version})`);
