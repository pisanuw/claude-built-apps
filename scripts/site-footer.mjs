#!/usr/bin/env node
/**
 * The "built by" footer shared by every deployed app.
 *
 * This file is the single source of the footer text. It is added to each
 * app's built index.html at deploy time, so no app carries its own copy:
 *   - Netlify apps: deploy.mjs calls injectFooterIntoDir() after the build.
 *   - mult-streak (Render, via backend-hub): its build script runs this CLI.
 *
 * Editing this file deploys nothing by itself: run the Deploy workflow manually
 * with `all` (or named apps) to ship it. Each Netlify deploy costs credits.
 *
 * The markup is a declarative shadow root, so the app's CSS cannot restyle the
 * footer and the footer's CSS cannot leak into the app. It inherits the page's
 * text color, so it matches light and dark pages alike.
 *
 * Usage: node scripts/site-footer.mjs <publishDir> <appName>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECTS_URL = 'https://pisanorg.github.io/yusuf/aiprojects.html';
export const CONTACT_EMAIL = 'builder@pisan.me';
/** Visible text for PROJECTS_URL: the URL without its scheme and extension. */
export const PROJECTS_LABEL = 'pisanorg.github.io/yusuf/aiprojects';

/** Marks an already-injected page so a second run is a no-op. */
export const MARKER = 'data-site-footer';

const STYLE = `
:host { display: block; box-sizing: border-box; width: 100%; grid-column: 1 / -1; align-self: stretch; clear: both; }
aside { box-sizing: border-box; max-width: 46rem; margin: 2.5rem auto 0; padding: 1rem 16px 1.5rem; border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent); font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; overflow-wrap: anywhere; }
p { margin: 0; }
p + p { margin-top: 0.4em; }
a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media print { :host { display: none; } }
`
  .trim()
  .replace(/\n/g, ' ');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The footer markup for one app. `app` names the app in the email subject. */
export function footerHtml(app) {
  const subject = encodeURIComponent(app ? `Project idea (via ${app})` : 'Project idea');
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${escapeHtml(subject)}`;
  return (
    `<site-footer ${MARKER}><template shadowrootmode="open"><style>${STYLE}</style>` +
    `<aside aria-label="About the builder"><p>` +
    `Built by Claude, guided by me. I create tools like this for small businesses, startups and educators. ` +
    `Want something like this for your own work? Email <a href="${mailto}">${CONTACT_EMAIL}</a>. ` +
    `Paid projects welcome, interesting ones may be done for free :-) ` +
    `More apps: <a href="${PROJECTS_URL}">${PROJECTS_LABEL}</a>.` +
    `</p><p>Yusuf Pisan</p></aside></template></site-footer>`
  );
}

/** Insert the footer before the page's last </body>; unchanged if already present. */
export function injectFooter(html, app) {
  if (html.includes(MARKER)) return html;
  const footer = footerHtml(app);
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? `${html}\n${footer}\n` : `${html.slice(0, at)}${footer}\n${html.slice(at)}`;
}

/**
 * Add the footer to `<publishDir>/index.html`. Only the root page: other HTML
 * files a build emits (iframes, previews) are not standalone pages.
 * Returns true if the file changed.
 */
export function injectFooterIntoDir(publishDir, app) {
  const file = path.join(publishDir, 'index.html');
  if (!existsSync(file)) throw new Error(`site-footer: no index.html in ${publishDir}`);
  const before = readFileSync(file, 'utf8');
  const after = injectFooter(before, app);
  if (after === before) return false;
  writeFileSync(file, after);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, app] = process.argv.slice(2);
  if (!dir || !app) {
    console.error('usage: node scripts/site-footer.mjs <publishDir> <appName>');
    process.exit(2);
  }
  const changed = injectFooterIntoDir(path.resolve(dir), app);
  console.log(`[site-footer] ${changed ? 'added footer to' : 'footer already in'} ${path.join(dir, 'index.html')}`);
}
