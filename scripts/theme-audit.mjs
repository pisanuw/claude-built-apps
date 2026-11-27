#!/usr/bin/env node
/**
 * Theme switch audit (review round 1 of the light and dark mode switch, M1).
 * Read-only. Two parts:
 *   - local: every copy of the switch in this repository against
 *     platform/src/theme (platform/src/theme/copies.mjs; the platform CI job
 *     runs the same check on every push);
 *   - live: each own-repo app's front page, which this repository's CI cannot
 *     see. The inline head snippet, or the hw-theme-init.js it loads, and a
 *     hw-theme.js served as a file are fetched and hashed. A bundled copy (a
 *     Vite app imports hw-theme.js) is not visible; that app's own test pins it.
 *
 *   node scripts/theme-audit.mjs            # both parts, a table each
 *   node scripts/theme-audit.mjs --local    # this repository only, no network
 *   node scripts/theme-audit.mjs --json
 *
 * Live statuses: current (every piece found matches), stale (a piece differs:
 * copy the new files into that repository), none (no switch on the page yet),
 * error (the page or a file could not be fetched). The exit code is 1 when a
 * local copy differs or a live app is stale or error; "none" does not fail
 * while the rollout is under way.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCopies, cspHash, inlineSnippets, sha256hex } from '../platform/src/theme/copies.mjs';
import { HW_THEME_SHA256, THEME_INIT_CSP } from '../platform/src/theme/snippet.mjs';
import { OWN_REPO_APPS } from './footer-audit.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Own-repo apps the footer audit does not list (hintwise-workflow
 * registry/apps.md): some have no HintWise footer, but every one gets the
 * switch. pisan-analytics is left out: it answers 401 without its password.
 */
export const EXTRA_APPS = Object.freeze([
  { app: 'screen-reader-journeys', host: 'screen-reader-journeys.hintwise.org', repo: 'pisan-labs/screen-reader-journeys' },
  { app: 'myuni', host: 'myuni.top', repo: 'pisanuw/myuni' },
  { app: 'meetme', host: 'meetme.hintwise.org', repo: 'pisanuw/meetme' },
  { app: 'studio', host: 'studio.hintwise.org', repo: 'pisanuw/daily-project-ideas' },
  { app: 'chesstd-server', host: 'td.hintwise.org', repo: 'pisan-labs/chess-tournament-director' },
  { app: 'ranked-voting', host: 'ranked-voting.hintwise.org', repo: 'pisanuw/ranked-voting' },
]);

/** Two lists as one, each host once (an app the footer audit adds later stays listed once). */
export function liveApps(own, extra) {
  const seen = new Set();
  return [...own.map(([app, host, repo]) => ({ app, host, repo })), ...extra].filter(({ host }) => !seen.has(host) && seen.add(host));
}

/** Own-repo apps to fetch: the footer audit's list, plus EXTRA_APPS. */
export const LIVE_APPS = Object.freeze(liveApps(OWN_REPO_APPS, EXTRA_APPS));

/** The src of each classic <script> whose file is named `name`. */
export function scriptSrcs(html, name) {
  return [...html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((m) => m[1])
    .filter((src) => src.split(/[?#]/)[0].endsWith(`/${name}`) || src === name);
}

/** Check one live app. `fetchImpl` is injectable for tests. */
export async function auditLive({ app, host, repo }, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const get = async (url) => {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const base = `https://${host}/`;
  try {
    const html = (await get(base)).toString('utf8');
    const pieces = inlineSnippets(html).map((body) => ({ piece: 'head snippet', ok: cspHash(body) === THEME_INIT_CSP }));
    for (const src of scriptSrcs(html, 'hw-theme-init.js')) {
      pieces.push({ piece: src, ok: cspHash(await get(new URL(src, base))) === THEME_INIT_CSP });
    }
    for (const src of scriptSrcs(html, 'hw-theme.js')) {
      pieces.push({ piece: src, ok: sha256hex(await get(new URL(src, base))) === HW_THEME_SHA256 });
    }
    const status = pieces.length === 0 ? 'none' : pieces.every((p) => p.ok) ? 'current' : 'stale';
    return { app, host, repo, status, pieces };
  } catch (e) {
    return { app, host, repo, status: 'error', error: e?.message || String(e) };
  }
}

async function main(argv) {
  const local = checkCopies(REPO);
  const live = argv.includes('--local') ? [] : await Promise.all(LIVE_APPS.map((a) => auditLive(a)));
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ local, live }, null, 2) + '\n');
  } else {
    console.log(`Local copies: ${local.copies.length}, differing: ${local.problems.length}`);
    for (const c of local.copies) console.log(`  ${c.ok ? 'current' : 'DIFFERS'}  ${c.kind.padEnd(16)} ${c.file}`);
    if (live.length) console.log('\nOwn-repo apps, live:');
    for (const r of live) console.log(`  ${r.status.padEnd(8)} ${r.app.padEnd(24)} ${r.host.padEnd(40)} ${r.repo}${r.error ? `  ${r.error}` : ''}`);
  }
  return local.problems.length || live.some((r) => r.status === 'stale' || r.status === 'error') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
