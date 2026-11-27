#!/usr/bin/env node
/**
 * The values an app copies to use the shared light and dark mode switch
 * (README.md beside this file). Like FOOTER_STYLE_CSP in
 * scripts/site-footer.mjs, they are computed from the files, so they change
 * whenever a file does, and test/theme-snippet.test.ts checks README.md shows them.
 *
 * Usage: node platform/src/theme/snippet.mjs   (prints them)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

/** localStorage key that holds the visitor's choice, "light" or "dark". */
export const STORAGE_KEY = 'hw-theme';
/** Event fired on document whenever the theme changes (detail.theme). */
export const THEME_EVENT = 'hw-themechange';
/** The custom element that draws the button. */
export const TOGGLE_TAG = 'hw-theme-toggle';

/**
 * The head script, exactly as it goes between <script> and </script>. The
 * file has no trailing newline, so a copy served as a file
 * (<script src="/hw-theme-init.js">) has the same bytes and the same hash.
 */
export const THEME_INIT_JS = read('theme-init.js');

/** The tag to put at the top of <head>, before any stylesheet. */
export const THEME_INIT_SNIPPET = `<script>${THEME_INIT_JS}</script>`;

/**
 * The CSP source that allows the inline snippet: a page whose script-src has
 * no 'unsafe-inline' lists it. It is also the sha256 (base64) of a copy of
 * theme-init.js served as a file.
 */
export const THEME_INIT_CSP = `'sha256-${createHash('sha256').update(THEME_INIT_JS).digest('base64')}'`;

/** sha256 (hex) of hw-theme.js: an app's test pins its copy to this. */
export const HW_THEME_SHA256 = createHash('sha256').update(read('hw-theme.js')).digest('hex');

/** The values, as the CLI prints them. */
export function describe() {
  return [
    `THEME_INIT_SNIPPET  ${THEME_INIT_SNIPPET}`,
    `THEME_INIT_CSP      ${THEME_INIT_CSP}`,
    `HW_THEME_SHA256     ${HW_THEME_SHA256}`,
    `STORAGE_KEY         ${STORAGE_KEY}`,
    `THEME_EVENT         ${THEME_EVENT}`,
    `TOGGLE_TAG          ${TOGGLE_TAG}`,
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(`${describe()}\n`);
