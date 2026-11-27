/**
 * Finds every copy of the theme switch in this repository and checks it
 * against the source here (review round 1, M1: a platform change must fail CI
 * for every app whose copy differs). test/theme-copies.test.ts runs it on the
 * whole repository in the platform CI job, which runs on every push;
 * scripts/theme-audit.mjs prints it and adds the live own-repo apps.
 *
 * Checked:
 *   - every file named hw-theme.js: its sha256 is HW_THEME_SHA256;
 *   - every file named hw-theme-init.js: its sha256 is THEME_INIT_CSP's;
 *   - every inline script element that holds the quoted storage key, in an
 *     .html file or written out in a source file (.js, .mjs, .cjs, .jsx,
 *     .ts, .tsx, .mts, .cts: a layout, or a page a function renders): it is
 *     the head snippet, byte for byte (its hash is THEME_INIT_CSP).
 * An inline script is taken for the snippet by the quoted key, so app code
 * that listens for the change event or writes the button's tag is not.
 * (A source file's comments are read too: do not write a script element
 * around the quoted key in one.)
 * Skipped: node_modules, dist, coverage, build, out, test-results,
 * playwright-report and dot folders at any depth; the source folder itself
 * (platform/ at the top); in source files, tests (*.test.*, *.spec.*) and
 * type declarations (*.d.ts), which hold sample snippets on purpose.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { HW_THEME_SHA256, THEME_INIT_CSP } from './snippet.mjs';

const SKIP = new Set(['node_modules', 'dist', 'coverage', 'build', 'out', 'test-results', 'playwright-report']);
const SOURCE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/;
const NOT_SOURCE = /\.d\.[cm]?ts$|\.(?:test|spec)\.[^.]+$/;
/** The storage key, quoted: 'hw-theme' (or a renamed 'hw-theme-…'), not 'hw-themechange', 'hw-theme-toggle' or a file name. */
const KEY = /(['"`])hw-theme(?!change|-toggle)[\w-]*\1/;

export const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
export const cspHash = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/** True for a source file whose <script> literals are checked. */
export const isSourceFile = (name) => SOURCE.test(name) && !NOT_SOURCE.test(name);

/** Files under root worth checking, as paths relative to root. `skipTop` names top-level folders to leave out. */
export function themeFiles(root, { skipTop = ['platform'] } = {}) {
  const out = [];
  const walk = (dir, top) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || SKIP.has(name) || (top && skipTop.includes(name))) continue;
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file, false);
      else if (name === 'hw-theme.js' || name === 'hw-theme-init.js' || name.endsWith('.html') || isSourceFile(name)) out.push(path.relative(root, file));
    }
  };
  walk(root, true);
  return out;
}

/** The contents of inline <script> elements (no src) that hold the storage key. */
export function inlineSnippets(html) {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs = '', body]) => !/\ssrc\s*=/.test(attrs) && KEY.test(body))
    .map(([, , body]) => body);
}

/**
 * Every copy under root and whether it matches the source.
 * Returns { copies: [{ file, kind, ok }], problems: [{ file, problem }] }.
 */
export function checkCopies(root, options) {
  const copies = [];
  for (const file of themeFiles(root, options)) {
    const name = path.basename(file);
    const data = readFileSync(path.join(root, file));
    if (name === 'hw-theme.js') copies.push({ file, kind: 'hw-theme.js', ok: sha256hex(data) === HW_THEME_SHA256 });
    else if (name === 'hw-theme-init.js') copies.push({ file, kind: 'hw-theme-init.js', ok: cspHash(data) === THEME_INIT_CSP });
    else for (const body of inlineSnippets(data.toString('utf8'))) copies.push({ file, kind: 'head snippet', ok: cspHash(body) === THEME_INIT_CSP });
  }
  const problems = copies
    .filter((c) => !c.ok)
    .map((c) => ({ file: c.file, problem: `${c.kind} differs from platform/src/theme: copy it again (README, "The values")` }));
  return { copies, problems };
}
