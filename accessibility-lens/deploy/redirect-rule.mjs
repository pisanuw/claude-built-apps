#!/usr/bin/env node
/* global process, console, fetch */
/**
 * Create or update the Cloudflare Single Redirect rule on the pisan.me zone
 * that sends each moved app's old address to its new one:
 *
 *   https://<x>.pisan.me/<path>?<query>  ->  301  https://<x>.hintwise.org/<path>?<query>
 *
 * One rule (ref RULE_REF) covers every host whose new name has the same
 * label. A host renamed in HOST_RENAMES (scripts/domains.mjs), such as
 * daily-project-ideas.pisan.me -> studio.hintwise.org, cannot share it (the
 * target is computed from the host, and regex_replace may appear only once),
 * so each rename gets its own rule, ref `${RULE_REF}__<label>`, with a fixed
 * target host. Adding a rename = one line in HOST_RENAMES.
 *
 * - The rule matches an explicit host list (`http.host in {...}`), never a
 *   wildcard, so the personal site (pisan.me, www, g, yusuf, zoom) and the
 *   email names can never be caught. Those names are refused outright.
 * - Names given are merged with the hosts the rule already holds; nothing is
 *   ever removed from it here.
 * - Only our rules (ref RULE_REF and RULE_REF__<label>) are touched: added to,
 *   or patched in, the zone's http_request_dynamic_redirect entry point
 *   ruleset. Other rules in that ruleset are never changed or deleted.
 * - td.pisan.me (the Chess TD API) is only included when passed explicitly:
 *   a 301 turns POST into GET and breaks CORS preflight.
 * - A redirect rule only runs on proxied records; migrate-domains.mjs
 *   (step `switch`) proxies each <x>.pisan.me record after adding it here.
 *
 *   node redirect-rule.mjs [--dry-run] [--hintwise-apex] [name ...]
 *     name: "bombe-bench" or "bombe-bench.pisan.me"; none: just show the rule.
 *     --hintwise-apex: also make sure hintwise.org and www.hintwise.org 301 to
 *     studio.hintwise.org<path> (one rule on the hintwise.org zone; see
 *     ensureApexRedirect). It needs those two records proxied (they are).
 *
 * Env: CLOUDFLARE_API_TOKEN (Zone:Read and Single Redirect edit on pisan.me,
 * and on hintwise.org for --hintwise-apex),
 * CLOUDFLARE_ZONE_ID (optional fallback). Run by the "Redirect rule" workflow.
 */
import { pathToFileURL } from 'node:url';
import { cfApi, zoneIdFor } from './cloudflare-dns.mjs';
import { APP_DOMAIN, OLD_DOMAIN, HOST_RENAMES, appDomainFor } from '../../scripts/domains.mjs';

export const PHASE = 'http_request_dynamic_redirect';
export const RULE_REF = 'hintwise_moved_apps';
export const RULE_DESCRIPTION = `Moved apps: <x>.${OLD_DOMAIN} -> <x>.${APP_DOMAIN} (managed by claude-built-apps redirect-rule.mjs)`;
/** Cloudflare's limit on a rule expression's length (non-Enterprise plans). */
export const MAX_EXPRESSION = 4096;

/** Names that stay on pisan.me and must never be redirected. */
export const PROTECTED = new Set([
  'www', 'g', 'yusuf', 'zoom', 'www.g', 'www.yusuf', 'www.zoom',
  'send', 'reply', 'send.reply', '_dmarc', 'resend._domainkey', 'resend._domainkey.reply',
  'verified-for-netlify', 'subdomain-owner-verification', 'microsoft-education', 'ypdsa',
]);

const OLD_SUFFIX = `.${OLD_DOMAIN}`;

/** "bombe-bench" or "bombe-bench.pisan.me" -> "bombe-bench.pisan.me"; throws on anything else. */
export function normalizeHost(name) {
  let n = String(name).trim().toLowerCase().replace(/\.$/, '');
  if (n.endsWith(OLD_SUFFIX)) n = n.slice(0, -OLD_SUFFIX.length);
  if (PROTECTED.has(n)) throw new Error(`${n}${OLD_SUFFIX} stays on ${OLD_DOMAIN} and is never redirected`);
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(n)) {
    throw new Error(`not a single app name under ${OLD_DOMAIN}: ${JSON.stringify(name)}`);
  }
  return `${n}${OLD_SUFFIX}`;
}

/** The hosts in a rule expression this script wrote ("" -> []). */
export function parseHosts(expression) {
  const e = String(expression || '').trim();
  const one = /^http\.host eq "([^"]+)"$/.exec(e);
  if (one) return [one[1]];
  const m = /^http\.host in \{([^}]*)\}$/.exec(e);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** True when the host's new name is not just the same label on hintwise.org. */
export const isRenamed = (host) => Object.hasOwn(HOST_RENAMES, host.slice(0, -OLD_SUFFIX.length));

export function buildExpression(hosts) {
  const list = [...new Set(hosts)].sort();
  for (const h of list) {
    if (!h.endsWith(OLD_SUFFIX) || h.includes('"') || h.includes('*')) throw new Error(`bad host ${h}`);
  }
  return `http.host in {${list.map((h) => `"${h}"`).join(' ')}}`;
}

/**
 * Target URL: https://<host with .pisan.me replaced by .hintwise.org><path>.
 * regex_replace is allowed once per expression in a dynamic redirect target;
 * "[.]" instead of "\." keeps the pattern free of backslash escaping.
 */
export const TARGET_EXPRESSION =
  `concat("https://", regex_replace(http.host, "[.]${OLD_DOMAIN.replace('.', '[.]')}$", ".${APP_DOMAIN}"), http.request.uri.path)`;

export function buildRule(hosts) {
  const expression = buildExpression(hosts);
  if (expression.length > MAX_EXPRESSION) {
    throw new Error(`the rule expression would be ${expression.length} characters (limit ${MAX_EXPRESSION})`);
  }
  return {
    ref: RULE_REF,
    description: RULE_DESCRIPTION,
    expression,
    action: 'redirect',
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: { expression: TARGET_EXPRESSION },
        preserve_query_string: true,
      },
    },
    enabled: true,
  };
}

/** The rule for one renamed host: a fixed target host, path appended. */
export function buildRenameRule(host) {
  const to = appDomainFor(host);
  if (!isRenamed(host) || !/^[a-z0-9.-]+$/.test(to)) throw new Error(`${host} is not in HOST_RENAMES`);
  return {
    ref: renameRef(host),
    description: `Moved app: ${host} -> ${to} (managed by claude-built-apps redirect-rule.mjs)`,
    expression: `http.host eq "${host}"`,
    action: 'redirect',
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: { expression: `concat("https://${to}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
    enabled: true,
  };
}
export const renameRef = (host) => `${RULE_REF}__${host.slice(0, -OLD_SUFFIX.length).replace(/[^a-z0-9]/g, '_')}`;

/** Our main rule in a ruleset: by ref, else by description. */
export const findOurRule = (ruleset) =>
  (ruleset?.rules || []).find((r) => r.ref === RULE_REF) ||
  (ruleset?.rules || []).find((r) => r.description === RULE_DESCRIPTION);
const findByRef = (ruleset, ref) => (ruleset?.rules || []).find((r) => r.ref === ref);
const sameRule = (a, b) =>
  a.expression === b.expression &&
  a.enabled !== false &&
  JSON.stringify(a.action_parameters?.from_value?.target_url) === JSON.stringify(b.action_parameters.from_value.target_url) &&
  a.action_parameters?.from_value?.status_code === 301 &&
  a.action_parameters?.from_value?.preserve_query_string === true;

/** All hosts our rules redirect. */
export function coveredHosts(ruleset) {
  const main = parseHosts(findOurRule(ruleset)?.expression);
  const renamed = (ruleset?.rules || []).filter((r) => r.ref?.startsWith(`${RULE_REF}__`)).flatMap((r) => parseHosts(r.expression));
  return [...new Set([...main, ...renamed])].sort();
}

/**
 * Make sure our rules redirect every host in `add` (merged with what they
 * already hold). Returns { before, after, changed }: host lists.
 */
export async function ensureRedirectHosts({ add = [], dryRun = false, env = process.env, fetchImpl = fetch, log = console.log }) {
  const wanted = [...new Set(add.map(normalizeHost))];
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  const zoneId = await zoneIdFor({ domain: `www.${OLD_DOMAIN}`, token, env, fetchImpl });

  let ruleset = await entrypoint({ zoneId, token, fetchImpl });
  const ours = findOurRule(ruleset);
  const mainBefore = ours ? parseHosts(ours.expression) : [];
  if (ours && mainBefore.length === 0) {
    throw new Error(`our rule ${ours.id} has an expression this script did not write; fix it by hand: ${ours.expression}`);
  }
  const before = coveredHosts(ruleset);
  const mine = (r) => r === ours || r.ref?.startsWith(`${RULE_REF}__`);
  const othersBefore = (ruleset?.rules || []).filter((r) => !mine(r)).length;
  log(`Before: ${ruleset ? `ruleset ${ruleset.id}, ${othersBefore} other rule(s)` : 'no redirect ruleset yet'}; ` +
    `our rules cover ${before.length} host(s): ${before.join(' ') || '-'}`);

  // The changes: the main rule with the merged list, and one rule per renamed host.
  const changes = [];
  const mainAfter = [...new Set([...mainBefore.filter((h) => !isRenamed(h)), ...wanted.filter((h) => !isRenamed(h))])].sort();
  if (mainAfter.length !== mainBefore.length || mainAfter.some((h) => !mainBefore.includes(h))) {
    changes.push({ existing: ours, rule: buildRule(mainAfter) });
  }
  for (const host of wanted.filter(isRenamed)) {
    const rule = buildRenameRule(host);
    const existing = findByRef(ruleset, rule.ref);
    if (!existing || !sameRule(existing, rule)) changes.push({ existing, rule });
  }
  const after = [...new Set([...before, ...wanted])].sort();
  if (changes.length === 0) {
    log(wanted.length ? 'Every host is already redirected; nothing to do.' : 'No hosts given; nothing to do.');
    return { before, after: before, changed: false };
  }
  if (wanted.includes(`td${OLD_SUFFIX}`) && !before.includes(`td${OLD_SUFFIX}`)) {
    log(`::warning::td${OLD_SUFFIX} was passed explicitly and will be redirected.`);
  }
  for (const { existing, rule } of changes) {
    const verb = !ruleset ? 'create the entry point ruleset with' : existing ? `update rule ${existing.id}:` : 'add';
    log(`${dryRun ? 'Would' : 'Will'} ${verb} ${rule.ref}: ${rule.expression}\n  -> ${rule.action_parameters.from_value.target_url.expression} (301, query string kept)`);
  }
  if (dryRun) {
    log('dry run: nothing changed.');
    return { before, after, changed: false };
  }

  ruleset = await applyChanges({ zoneId, ruleset, changes, token, fetchImpl });
  const now = coveredHosts(ruleset);
  const missing = after.filter((h) => !now.includes(h));
  if (missing.length) throw new Error(`after the update our rules are missing: ${missing.join(' ')}`);
  const othersAfter = (ruleset.rules || []).filter((r) => !(r.ref === RULE_REF || r.ref?.startsWith(`${RULE_REF}__`))).length;
  log(`After: ruleset ${ruleset.id}, our rules cover ${now.length} host(s); ${othersAfter} other rule(s) untouched.`);
  return { before, after: now, changed: true };
}

/**
 * Apply rule changes to a zone's redirect entry point ruleset, one call each:
 * create the ruleset (when none), PATCH our existing rule, or POST a new one.
 * Never PUTs the whole ruleset, so other rules cannot be lost.
 */
async function applyChanges({ zoneId, ruleset, changes, token, fetchImpl }) {
  for (const { existing, rule } of changes) {
    if (!ruleset) {
      ruleset = await cfApi(fetchImpl, token, `/zones/${zoneId}/rulesets`, {
        method: 'POST',
        body: JSON.stringify({ name: 'default', kind: 'zone', phase: PHASE, rules: [rule] }),
      });
    } else if (existing) {
      ruleset = await cfApi(fetchImpl, token, `/zones/${zoneId}/rulesets/${ruleset.id}/rules/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(rule),
      });
    } else {
      ruleset = await cfApi(fetchImpl, token, `/zones/${zoneId}/rulesets/${ruleset.id}/rules`, {
        method: 'POST',
        body: JSON.stringify(rule),
      });
    }
  }
  return ruleset;
}

async function entrypoint({ zoneId, token, fetchImpl }) {
  try {
    return await cfApi(fetchImpl, token, `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);
  } catch (e) {
    if (e.status !== 404) throw e;
    return null;
  }
}

/**
 * hintwise.org zone: the apex and www (proxied CNAMEs, which a redirect rule
 * needs) send https://studio.hintwise.org<path>, 301, query kept. One rule,
 * ref APEX_RULE_REF; nothing else in that zone is touched. This never edits
 * DNS records: if the apex or www were ever made DNS only, the rule would
 * silently stop running.
 */
export const APEX_RULE_REF = 'hintwise_apex_to_studio';
export const APEX_TARGET = `studio.${APP_DOMAIN}`;
export function buildApexRule() {
  return {
    ref: APEX_RULE_REF,
    description: `${APP_DOMAIN} and www.${APP_DOMAIN} -> ${APEX_TARGET} (managed by claude-built-apps redirect-rule.mjs)`,
    expression: `http.host in {"${APP_DOMAIN}" "www.${APP_DOMAIN}"}`,
    action: 'redirect',
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: { expression: `concat("https://${APEX_TARGET}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
    enabled: true,
  };
}

export async function ensureApexRedirect({ dryRun = false, env = process.env, fetchImpl = fetch, log = console.log }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  const zoneId = await zoneIdFor({ domain: `www.${APP_DOMAIN}`, token, env, fetchImpl });
  const ruleset = await entrypoint({ zoneId, token, fetchImpl });
  const rule = buildApexRule();
  const existing = findByRef(ruleset, APEX_RULE_REF);
  log(`Before (${APP_DOMAIN}): ${ruleset ? `ruleset ${ruleset.id}, ${(ruleset.rules || []).length} rule(s)` : 'no redirect ruleset yet'}; ` +
    `apex rule: ${existing ? `${existing.id}: ${existing.expression}` : 'none'}`);
  if (existing && sameRule(existing, rule)) {
    log('The apex redirect is already in place; nothing to do.');
    return { changed: false };
  }
  log(`${dryRun ? 'Would' : 'Will'} ${existing ? `update rule ${existing.id}` : 'add'} ${rule.ref}: ${rule.expression}\n  -> ${rule.action_parameters.from_value.target_url.expression} (301, query string kept)`);
  if (dryRun) {
    log('dry run: nothing changed.');
    return { changed: false };
  }
  const after = await applyChanges({ zoneId, ruleset, changes: [{ existing, rule }], token, fetchImpl });
  const now = findByRef(after, APEX_RULE_REF);
  if (!now || !sameRule(now, rule)) throw new Error('after the update the apex rule is not in place');
  log(`After (${APP_DOMAIN}): ruleset ${after.id}, apex rule ${now.id}; ${(after.rules || []).length - 1} other rule(s) untouched.`);
  return { changed: true };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apex = args.includes('--hintwise-apex');
  const names = args.filter((a) => !a.startsWith('--')).flatMap((a) => a.split(/[\s,]+/)).filter(Boolean);
  if (names.length || !apex) await ensureRedirectHosts({ add: names, dryRun });
  if (apex) await ensureApexRedirect({ dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.log(`::error::${e.message}`);
    process.exit(1);
  });
}
