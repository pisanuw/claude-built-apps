#!/usr/bin/env node
/**
 * Footer audit (owner, 18 November 2026: "Add the footer audit to Keeper's
 * weekly checks"). Read-only: fetches each live app's front page and compares
 * its HintWise footer with footerHtml(app) as it is today.
 *
 *   node scripts/footer-audit.mjs          # a table, then a summary
 *   node scripts/footer-audit.mjs --json   # one JSON array
 *
 * Statuses:
 *   current    the footer is byte-identical to footerHtml(app)
 *   stale      a footer from before the logo (11 Nov 2026): the app needs a deploy
 *   differs    a footer with the logo, but other bytes differ (an older text,
 *              another app name, or a build that minified its style)
 *   duplicate  more than one footer outside <script>
 *   missing    no footer, and target.yml does not say `footer: false`
 *   off        no footer, as target.yml asks (`footer: false`)
 *   error      the page could not be fetched
 * The exit code is 1 when any app is stale, differs, duplicate, missing or error.
 *
 * Apps in this repository get the footer at deploy time (deploy.mjs), so a
 * stale one is fixed by redeploying the app, which costs Netlify credits and
 * needs the owner's yes. Apps in their own repositories embed it, so theirs is
 * fixed in their own repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { footerHtml } from './site-footer.mjs';
import { appDomainFor } from './domains.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Apps that embed the footer in their own repository: [footer app name, host, repository]. */
export const OWN_REPO_APPS = Object.freeze([
  ['upvoteme', 'upvoteme.hintwise.org', 'pisanuw/upvote'],
  ['paste-md', 'paste-md.hintwise.org', 'pisanuw/pastemd'],
  ['stepwise', 'stepwise.hintwise.org', 'pisan-labs/visualizing-data-structures'],
  ['photo2pgn', 'photo2pgn.hintwise.org', 'pisan-labs/photo2pgn'],
  ['chesstd', 'chesstd.hintwise.org', 'pisan-labs/chess-tournament-director'],
  ['udebt', 'udebt.hintwise.org', 'pisanuw/understanding-debt'],
  ['ypai', 'ypai.hintwise.org', 'pisanuw/digitalme'],
  ['ranked-voting', 'ranked-voting.hintwise.org', 'pisanuw/ranked-voting'],
]);

const NEEDS_ATTENTION = new Set(['stale', 'differs', 'duplicate', 'missing', 'error']);

/** Every app in this repository with a deploy/target.yml: { app, dir, host, footerOff, provider }. */
export function repoTargets(root = REPO) {
  const out = [];
  for (const dir of fs.readdirSync(root).sort()) {
    const file = path.join(root, dir, 'deploy', 'target.yml');
    if (!fs.existsSync(file)) continue;
    const yml = fs.readFileSync(file, 'utf8');
    const get = (key) => (yml.match(new RegExp(`^\\s*${key}:\\s*['"]?([^'"\\s#]+)`, 'm')) || [])[1];
    const domain = get('customDomain');
    out.push({
      app: get('projectName') || dir,
      dir,
      provider: get('provider') || '',
      host: domain ? appDomainFor(domain) : null,
      footerOff: /^\s*footer:\s*false\b/m.test(yml),
      source: 'claude-built-apps',
    });
  }
  return out;
}

/** The page without the contents of <script> elements (a Next.js payload repeats the footer as data). */
export function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/** The footers in a page, outside <script>. */
export function footersIn(html) {
  const page = stripScripts(html);
  const end = '</site-footer>';
  return page
    .split('<site-footer')
    .slice(1)
    .map((rest) => '<site-footer' + rest.slice(0, rest.indexOf(end) + end.length));
}

/** The status of one page's footer against footerHtml(app). */
export function classify(html, app, { footerOff = false } = {}) {
  const found = footersIn(html);
  if (found.length === 0) return footerOff ? 'off' : 'missing';
  if (found.length > 1) return 'duplicate';
  if (found[0] === footerHtml(app)) return 'current';
  return found[0].includes('class="mark"') ? 'differs' : 'stale';
}

/** Fetch and classify every app. `fetchImpl` is injectable for tests. */
export async function audit(targets, { fetchImpl = fetch, concurrency = 8, timeoutMs = 20000 } = {}) {
  const check = async (t) => {
    if (!t.host) return { ...t, status: t.provider === 'netlify' ? 'missing' : 'no-page' };
    try {
      const res = await fetchImpl(`https://${t.host}/`, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const html = await res.text();
      return { ...t, http: res.status, status: res.ok ? classify(html, t.app, t) : 'error' };
    } catch (e) {
      return { ...t, status: 'error', error: e?.name || 'Error' };
    }
  };
  const results = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    results.push(...(await Promise.all(targets.slice(i, i + concurrency).map(check))));
  }
  return results;
}

/** Counts by status. */
export function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

async function main(argv) {
  const targets = [
    ...repoTargets(),
    ...OWN_REPO_APPS.map(([app, host, repo]) => ({ app, host, dir: '', provider: '', footerOff: false, source: repo })),
  ];
  const results = await audit(targets);
  const order = ['missing', 'duplicate', 'differs', 'stale', 'error', 'off', 'no-page', 'current'];
  results.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.app.localeCompare(b.app));
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    for (const r of results) {
      console.log([r.status.padEnd(9), r.app.padEnd(28), (r.host || '-').padEnd(40), String(r.http ?? r.error ?? ''), r.source].join(' '));
    }
    console.log('\n' + JSON.stringify(summarize(results)));
  }
  return results.some((r) => NEEDS_ATTENTION.has(r.status)) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
