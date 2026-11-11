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
 * The line breaks are part of the text (owner's wording, 2026-11-08): six
 * lines separated by <br>, then the name in its own paragraph. "free :-)" is
 * joined by a no-break space so the smiley never wraps onto a line by itself,
 * "Email builder@hintwise.org." and "interesting ones may be done for free
 * :-)" do not wrap (.nb), so on a phone the address never sits alone and the
 * second half of the paid-projects line moves down whole.
 *
 * Usage: node scripts/site-footer.mjs <publishDir> <appName>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECTS_URL = 'https://studio.hintwise.org/';
export const CONTACT_EMAIL = 'builder@hintwise.org';
/** Visible text for PROJECTS_URL: the URL without its scheme and extension. */
export const PROJECTS_LABEL = 'studio.hintwise.org';
/** Yusuf Pisan's academic page. Not known yet: while empty, the footer omits the link. */
export const ACADEMIC_URL = 'https://pisanorg.github.io/yusuf/';
/** Visible text for ACADEMIC_URL. */
export const ACADEMIC_LABEL = 'https://pisanorg.github.io/yusuf/';

/**
 * The HintWise icon (platform/brand/hintwise-icon.svg, coordinates rounded to
 * 0.1), shown small above the text. It carries its own colours (indigo square,
 * white "h", coral spark), so it reads on light and dark pages alike, and it is
 * decorative: the text already names HintWise.
 */
export const LOGO_SVG =
  '<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="28" height="28" aria-hidden="true" focusable="false">' +
  '<rect width="1000" height="1000" rx="250" fill="#312E81"/><g transform="translate(0 1000) scale(1 -1)"><path fill="#FFFFFF" d="M557.1 253.2V441.5Q557.1 467.4 541.1 483.3Q525.2 499.3 500.7 499.3Q483.7 499.3 470.8 492.2Q457.8 485 450.4 471.8Q442.9 458.5 442.9 441.5L402.8 461.2Q402.8 500 419.1 529.2Q435.4 558.5 464.6 574.5Q493.9 590.4 532 590.4Q570.7 590.4 600 574.5Q629.2 558.5 645.2 530.3Q661.2 502 661.2 464.6V253.2ZM338.8 253.2V746.8H442.9V253.2Z"/><path fill="#FF7A45" d="M750 892.9 L781.4 781.4 L892.9 750 L781.4 718.6 L750 607.1 L718.6 718.6 L607.1 750 L718.6 781.4Z"/></g>' +
  '</svg>';

/** Marks an already-injected page so a second run is a no-op. */
export const MARKER = 'data-site-footer';

const STYLE = `
:host { display: block; box-sizing: border-box; width: 100%; grid-column: 1 / -1; align-self: stretch; clear: both; }
aside { box-sizing: border-box; max-width: 46rem; margin: 2.5rem auto 0; padding: 1rem 16px 1.5rem; border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent); font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; overflow-wrap: anywhere; }
p { margin: 0; }
.mark { display: block; margin: 0 auto 0.6rem; }
.nb { white-space: nowrap; }
p + p { margin-top: 0.4em; }
a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media print { :host { display: none; } }
`
  .trim()
  .replace(/\n/g, ' ');

/**
 * The CSP source that allows the footer's <style>: a page whose
 * Content-Security-Policy has a style-src without 'unsafe-inline' must list
 * it, or the browser drops the style and the footer shows unstyled and
 * left-aligned (PasteMD, 11 Nov 2026). The hash changes whenever STYLE does.
 */
export const FOOTER_STYLE_CSP = `'sha256-${createHash('sha256').update(STYLE).digest('base64')}'`;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The footer markup for one app. `app` names the app in the email subject.
 * `academicUrl` (default ACADEMIC_URL) adds " &middot; Academic page" to the fourth
 * line; an empty value leaves it out.
 */
export function footerHtml(app) {
  const subject = encodeURIComponent(app ? `Project idea (via ${app})` : 'Project idea');
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${escapeHtml(subject)}`;
  return (
    `<site-footer ${MARKER}><template shadowrootmode="open"><style>${STYLE}</style>` +
    `<aside aria-label="About the builder">${LOGO_SVG}<p>` +
    `HintWise builds tools like this for small businesses, startups and educators.<br>` +
    `Built with Claude, guided by experts.<br>` +
    `Want something like this for your own work? <span class="nb">Email <a href="${mailto}">${CONTACT_EMAIL}</a>.</span><br>` +
    `Paid projects welcome, <span class="nb">interesting ones may be done for free&nbsp;:-)</span><br>` +
    `Academic page: <a href="${ACADEMIC_URL}">${ACADEMIC_LABEL}</a><br>` +
    `More apps: <a href="${PROJECTS_URL}">${PROJECTS_LABEL}</a>` +
    `</p><p>Yusuf Pisan, Chief Education Officer, HintWise</p></aside></template></site-footer>`
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
