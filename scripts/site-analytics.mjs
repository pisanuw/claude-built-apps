#!/usr/bin/env node
/**
 * First-party analytics for every deployed app (owner, 17 Nov 2026: "add
 * analytics to the rest of the apps").
 *
 * Like the footer (site-footer.mjs), it is added at deploy time, so no app
 * carries its own copy:
 *   - copies platform/src/analytics/hw-events.js to <publishDir>/hw-events.js;
 *   - adds <script defer src="/hw-events.js" data-app="<slug>"></script> before
 *     </head> of every full HTML page in the publish dir (index.html, and pages
 *     such as terminal/index.html or practice.html).
 * `analytics: false` in target.yml opts an app out. The deploy also registers
 * the app's address in platform.analytics_apps (supabase-admin.mjs
 * analytics-register), since the app-events function stores events only from
 * a registered origin.
 *
 * The script sends page views (the path only, ids masked), seconds visible,
 * outbound link hosts, script errors (quoted text removed) and nothing at all
 * under Global Privacy Control or Do Not Track. No cookie, nothing kept in the
 * browser. platform/src/analytics/README.md has the details.
 *
 * A page whose Content-Security-Policy restricts connect-src must allow
 * ANALYTICS_CONNECT_CSP; script-src 'self' already covers the script.
 *
 * Editing this file deploys nothing by itself.
 *
 * Usage: node scripts/site-analytics.mjs <publishDir> <appSlug>
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one source of the browser script. */
export const ANALYTICS_SRC = path.join(ROOT, 'platform/src/analytics/hw-events.js');
/** Where the script is served from in every app. */
export const SCRIPT_PATH = '/hw-events.js';
/** The endpoint the script sends to (connect-src). */
export const ANALYTICS_CONNECT_CSP = 'https://auth.hintwise.org';
/** Same rule as platform.analytics_apps.slug and events.ts SLUG. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The tag for one app. */
export function analyticsTag(app) {
  if (!SLUG.test(app)) throw new Error(`site-analytics: "${app}" is not a valid app slug (${SLUG})`);
  return `<script defer src="${SCRIPT_PATH}" data-app="${app}"></script>`;
}

/** Insert the tag before </head> (else before </body>); unchanged if the page already loads the script. */
export function injectAnalytics(html, app) {
  const tag = analyticsTag(app);
  if (html.includes(`src="${SCRIPT_PATH}"`)) return html;
  const lower = html.toLowerCase();
  const head = lower.indexOf('</head>');
  if (head >= 0) return `${html.slice(0, head)}${tag}\n${html.slice(head)}`;
  const body = lower.lastIndexOf('</body>');
  return body >= 0 ? `${html.slice(0, body)}${tag}\n${html.slice(body)}` : html;
}

/** Every .html file under dir that is a full page (has <head or <html), skipping node_modules. */
export function htmlPages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out.push(...htmlPages(file));
    else if (name.endsWith('.html') && /<(head|html)[\s>]/i.test(readFileSync(file, 'utf8'))) out.push(file);
  }
  return out.sort();
}

/**
 * Copy the script into the publish dir and add the tag to every page.
 * Returns the pages that changed (relative to publishDir).
 */
export function injectAnalyticsIntoDir(publishDir, app, src = ANALYTICS_SRC) {
  if (!existsSync(path.join(publishDir, 'index.html'))) throw new Error(`site-analytics: no index.html in ${publishDir}`);
  analyticsTag(app); // validates the slug before anything is written
  copyFileSync(src, path.join(publishDir, SCRIPT_PATH.slice(1)));
  const changed = [];
  for (const file of htmlPages(publishDir)) {
    const before = readFileSync(file, 'utf8');
    const after = injectAnalytics(before, app);
    if (after !== before) {
      writeFileSync(file, after);
      changed.push(path.relative(publishDir, file));
    }
  }
  return changed;
}

/** The https origin the app is served from, for platform.analytics_apps. */
export function analyticsOrigin(domain) {
  const host = String(domain ?? '').trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? `https://${host}` : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, app] = process.argv.slice(2);
  if (!dir || !app) {
    console.error('usage: node scripts/site-analytics.mjs <publishDir> <appSlug>');
    process.exit(2);
  }
  const changed = injectAnalyticsIntoDir(path.resolve(dir), app);
  console.log(`[site-analytics] ${app}: script copied; tag added to ${changed.length ? changed.join(', ') : 'no page (already present)'}`);
}
