#!/usr/bin/env node
/* global process, console, fetch, setTimeout */
/**
 * Move Netlify apps from <x>.pisan.me to <x>.hintwise.org (docs/hintwise-migration.md,
 * Phases 2 and 4). Deploys nothing. Every step is idempotent, logs the state
 * before and after, and with --dry-run only reads.
 *
 *   node migrate-domains.mjs --step hosts  [--dry-run] <app ...|all>
 *   node migrate-domains.mjs --step switch [--dry-run] <app ...|all>
 *
 * step `hosts` (Phase 2: the new name answers alongside the old one), per app:
 *   1. CNAME <x>.hintwise.org -> the same target as <x>.pisan.me (read from
 *      Cloudflare: the Netlify site name can differ from the app name, e.g.
 *      pull-the-pin -> pull-the-pin-lab.netlify.app), DNS only. An existing
 *      record is never changed, only reported.
 *   2. <x>.hintwise.org added to the Netlify site as a domain alias.
 *   (A site in SITE_RENAMES is renamed first, e.g. daily-project-ideas ->
 *   hintwise, and the <x>.pisan.me CNAME repointed at the new .netlify.app.)
 *   3. The certificate requested, then https://<x>.hintwise.org/ awaited
 *      until it answers below 400 (which needs the certificate).
 *
 * step `switch` (Phase 4: pisan.me redirects), for the apps whose hintwise
 * name is attached and answers:
 *   1. their hosts added to the pisan.me redirect rule (redirect-rule.mjs),
 *   2. the <x>.pisan.me record set to proxied (content unchanged), so
 *      Cloudflare answers it with the 301 from then on,
 *   3. <x>.hintwise.org made the Netlify primary and the <x>.pisan.me alias
 *      removed (Netlify could not renew a certificate naming a proxied host).
 *   In that order, so the old address never reaches Netlify without its name.
 *
 * The new name is appDomainFor(<x>.pisan.me): <x>.hintwise.org, except the
 * renames in HOST_RENAMES (scripts/domains.mjs), e.g. daily-project-ideas ->
 * studio.hintwise.org. Apps are always named by their pisan.me label.
 *
 * `all` = every app whose target.yml has netlify.customDomain on pisan.me,
 * plus EXTRA_APPS. Render hosts (chesstd, td) are not changed here; the
 * manual steps are printed.
 *
 * Env: NETLIFY_AUTH_TOKEN, CLOUDFLARE_API_TOKEN (Zone:Read + DNS edit on both
 * zones, Single Redirect edit on pisan.me), CLOUDFLARE_ZONE_ID (optional
 * fallback). Run by the "Migrate domains" workflow.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cfApi, zoneIdFor, dnsRecords, showRecord } from './cloudflare-dns.mjs';
import { ensureRedirectHosts } from './redirect-rule.mjs';
import { APP_DOMAIN, OLD_DOMAIN, isSubdomainOf, hostLabelOf, appDomainFor } from '../../scripts/domains.mjs';

/** Netlify sites outside this repo that also move (name -> site read from DNS). */
export const EXTRA_APPS = ['daily-project-ideas', 'meetme', 'ypai', 'stepwise'];
/**
 * Netlify sites renamed during step `hosts`: current site name -> new name.
 * The old <site>.netlify.app name stops existing, so the same run repoints
 * the <x>.pisan.me CNAME at the new one (traffic keeps flowing meanwhile:
 * Netlify routes custom domains by Host header) and creates the hintwise
 * record straight at the new name. Owner's decision, 8 Nov 2026.
 */
export const SITE_RENAMES = Object.freeze({ 'daily-project-ideas': 'hintwise' });
/** Render hosts: out of scope here, manual steps only. */
export const RENDER_APPS = { chesstd: 'chess-td-web.onrender.com', td: 'chess-td-server.onrender.com' };

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const NETLIFY = '.netlify.app';

/** App names (the label before .pisan.me) from every <dir>/deploy/target.yml under `root`. */
export function appsFromRepo(root) {
  const names = [];
  for (const dir of readdirSync(root).sort()) {
    const file = path.join(root, dir, 'deploy', 'target.yml');
    if (!existsSync(file)) continue;
    const m = /^\s+customDomain:\s*['"]?([A-Za-z0-9.-]+)['"]?\s*(#.*)?$/m.exec(readFileSync(file, 'utf8'));
    if (m && isSubdomainOf(m[1], OLD_DOMAIN)) names.push(hostLabelOf(m[1]));
  }
  return names;
}

/** "all" or a list of names -> unique, validated names. */
export function selectApps(input, repoApps) {
  const words = input.flatMap((s) => String(s).split(/[\s,]+/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (words.length === 0) throw new Error('name the apps, or `all`');
  const names = words.includes('all') ? [...repoApps, ...EXTRA_APPS] : words.map((w) => hostLabelOf(w));
  for (const n of names) if (!NAME.test(n)) throw new Error(`bad app name: ${n}`);
  return [...new Set(names)];
}

function makeCtx({ env, fetchImpl, log, dryRun, sleep, attempts }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  if (!env.NETLIFY_AUTH_TOKEN) throw new Error('NETLIFY_AUTH_TOKEN is not set');
  async function netlify(route, init = {}) {
    const res = await fetchImpl(`https://api.netlify.com/api/v1${route}`, {
      ...init,
      headers: { authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}`, 'content-type': 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${route}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }
  return { env, token, fetchImpl, log, dryRun, sleep, attempts, netlify, cf: (route, init) => cfApi(fetchImpl, token, route, init) };
}

const showSite = (s) => `Netlify ${s.name}: primary ${s.custom_domain || 'none'}; aliases ${(s.domain_aliases || []).join(', ') || 'none'}`;
const hostRecord = (recs) => recs.find((r) => ['CNAME', 'A', 'AAAA'].includes(r.type));

/** One HTTPS request; returns { status, location } or { error }. */
async function probe(ctx, url) {
  try {
    const res = await ctx.fetchImpl(url, { redirect: 'manual' });
    return { status: res.status, location: res.headers?.get?.('location') || '' };
  } catch (e) {
    return { error: String(e.cause?.code || e.message || e).slice(0, 120) };
  }
}

async function waitAnswers(ctx, host, attempts) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    last = await probe(ctx, `https://${host}/`);
    if (last.status && last.status < 400) return last;
    if (i < attempts) await ctx.sleep(10000);
  }
  return last;
}

/** Read the old record and the Netlify site it points at. */
async function inspect(ctx, zones, name) {
  const oldHost = `${name}.${OLD_DOMAIN}`;
  const newHost = appDomainFor(oldHost);
  const oldRec = hostRecord(await dnsRecords({ zoneId: zones.old, name: oldHost, token: ctx.token, fetchImpl: ctx.fetchImpl }));
  if (!oldRec) throw new Error(`${oldHost} has no DNS record`);
  const target = String(oldRec.content).toLowerCase().replace(/\.$/, '');
  const newRec = hostRecord(await dnsRecords({ zoneId: zones.new, name: newHost, token: ctx.token, fetchImpl: ctx.fetchImpl }));
  const info = { name, oldHost, newHost, oldRec, newRec, target };
  if (oldRec.type !== 'CNAME' || !target.endsWith(NETLIFY)) return info;
  const fromTarget = target.slice(0, -NETLIFY.length);
  try {
    info.site = await ctx.netlify(`/sites/${target}`);
  } catch (e) {
    // Renamed by an earlier run whose DNS update did not happen: find it by its new name.
    if (!SITE_RENAMES[fromTarget]) throw e;
    info.site = await ctx.netlify(`/sites/${SITE_RENAMES[fromTarget]}${NETLIFY}`);
  }
  return info;
}

function logState(ctx, label, i) {
  ctx.log(`  ${label}: ${showRecord(i.oldRec)}; ${i.newRec ? showRecord(i.newRec) : `no ${i.newHost} record`}; ${i.site ? showSite(i.site) : 'no Netlify site'}`);
}

function manualSteps(ctx, name, target, step) {
  const oldHost = `${name}.${OLD_DOMAIN}`;
  const newHost = appDomainFor(oldHost);
  ctx.log(`::warning::${oldHost} -> ${target} is not a Netlify site; nothing changed. Manual steps:`);
  if (step === 'hosts') {
    ctx.log(`  1. "Set CNAME" workflow: ${newHost} -> ${target} (DNS only).`);
    ctx.log(`  2. Render dashboard (or API with RENDER_API_KEY): add ${newHost} as a custom domain of that service; wait for its certificate.`);
    ctx.log(`  3. Check: curl -sI https://${newHost}/ answers 200.`);
  } else {
    if (name === 'td') ctx.log(`  td.${OLD_DOMAIN} is the Chess TD API: do NOT redirect it until the web app calls td.${APP_DOMAIN} (a 301 breaks POST and CORS).`);
    ctx.log(`  1. "Redirect rule" workflow with ${name}; 2. set ${oldHost} to proxied in Cloudflare (content ${target});`);
    ctx.log(`  3. Render: keep or remove ${oldHost} on the service (once proxied, Render cannot renew its certificate for it).`);
  }
}

async function hostsStep(ctx, zones, name) {
  const i = await inspect(ctx, zones, name);
  ctx.log(`== ${name}: ${i.oldHost} -> ${i.target}`);
  logState(ctx, 'Before', i);
  if (!i.site) {
    manualSteps(ctx, name, i.target, 'hosts');
    return 'manual';
  }
  const { newHost, site } = i;
  let target = i.target;

  // A planned site rename, then the old record follows the site's real name.
  const renameTo = SITE_RENAMES[site.name];
  if (renameTo) {
    if (ctx.dryRun) {
      ctx.log(`  Netlify: would rename site ${site.name} -> ${renameTo}.`);
      site.name = renameTo; // for the rest of the dry run's messages
    } else {
      const renamed = await ctx.netlify(`/sites/${site.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameTo }) });
      if (renamed.name !== renameTo) throw new Error(`Netlify renamed ${site.name} to ${renamed.name}, not ${renameTo} (name taken?)`);
      ctx.log(`  Netlify: renamed site ${site.name} -> ${renameTo}.`);
      site.name = renameTo;
    }
  }
  const siteTarget = `${site.name}${NETLIFY}`;
  if (target !== siteTarget) {
    if (ctx.dryRun) ctx.log(`  DNS: would repoint ${i.oldHost} -> ${siteTarget} (was ${target}; proxied unchanged).`);
    else {
      await ctx.cf(`/zones/${zones.old}/dns_records/${i.oldRec.id}`, { method: 'PATCH', body: JSON.stringify({ content: siteTarget }) });
      ctx.log(`  DNS: repointed ${i.oldHost} -> ${siteTarget} (was ${target}).`);
    }
    target = siteTarget;
  }

  if (i.newRec) {
    const same = i.newRec.type === 'CNAME' && String(i.newRec.content).toLowerCase() === target;
    if (!same) ctx.log(`::warning::${newHost} already points at ${i.newRec.type} ${i.newRec.content}, not ${target}; left unchanged.`);
    else if (i.newRec.proxied) ctx.log(`::warning::${newHost} is proxied, so Netlify cannot issue its certificate; switch it to DNS only.`);
    else ctx.log(`  DNS: ${newHost} already -> ${target}.`);
  } else if (ctx.dryRun) {
    ctx.log(`  DNS: would create CNAME ${newHost} -> ${target} (DNS only).`);
  } else {
    await ctx.cf(`/zones/${zones.new}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: 'CNAME', name: newHost, content: target, proxied: false, ttl: 1, comment: `Moved from ${i.oldHost} by migrate-domains.mjs` }),
    });
    ctx.log(`  DNS: created CNAME ${newHost} -> ${target} (DNS only).`);
  }

  const aliases = site.domain_aliases || [];
  if (site.custom_domain === newHost || aliases.includes(newHost)) ctx.log(`  Netlify: ${newHost} already on ${site.name}.`);
  else if (ctx.dryRun) ctx.log(`  Netlify: would add ${newHost} as a domain alias of ${site.name}.`);
  else {
    await ctx.netlify(`/sites/${site.id}`, { method: 'PATCH', body: JSON.stringify({ domain_aliases: [...aliases, newHost] }) });
    ctx.log(`  Netlify: added ${newHost} as a domain alias of ${site.name}.`);
  }

  if (ctx.dryRun) {
    const p = await probe(ctx, `https://${newHost}/`);
    ctx.log(`  dry run: would request the certificate and wait; https://${newHost}/ now: ${p.status ?? p.error}`);
    return 'dry-run';
  }
  try {
    try {
      await ctx.netlify(`/sites/${site.id}/ssl`, { method: 'POST' });
      ctx.log('  Certificate requested.');
    } catch (e) {
      // A site that already has a Let's Encrypt certificate answers 422
      // "certificate parameter is required when updating an existing
      // certificate"; adding a domain then needs the renew endpoint (what the
      // dashboard's Renew certificate button calls).
      if (!String(e.message).includes('existing certificate')) throw e;
      await ctx.netlify(`/sites/${site.id}/ssl/renew`, { method: 'POST' });
      ctx.log('  Certificate renewal requested (adds the new domain).');
    }
  } catch (e) {
    ctx.log(`  Certificate request not accepted yet (Netlify retries on its own): ${String(e.message).slice(0, 160)}`);
  }
  const p = await waitAnswers(ctx, newHost, ctx.attempts);
  const after = await inspect(ctx, zones, name);
  logState(ctx, 'After', after);
  if (p.status && p.status < 400) {
    ctx.log(`::notice::${name}: https://${newHost}/ answers HTTP ${p.status}.`);
    return 'ok';
  }
  ctx.log(`::error::${name}: https://${newHost}/ did not answer below 400 (last: ${p.status ?? p.error}); check the certificate in Netlify.`);
  return 'failed';
}

/** Switch precondition: hintwise attached to the site, DNS-only CNAME, and answering. */
async function readyToSwitch(ctx, i) {
  const why = [];
  const onSite = i.site.custom_domain === i.newHost || (i.site.domain_aliases || []).includes(i.newHost);
  if (!onSite) why.push(`${i.newHost} is not on Netlify site ${i.site.name} (run step hosts)`);
  if (!i.newRec) why.push(`${i.newHost} has no DNS record (run step hosts)`);
  const p = await probe(ctx, `https://${i.newHost}/`);
  if (!(p.status && p.status < 400)) why.push(`https://${i.newHost}/ answers ${p.status ?? p.error}`);
  return why;
}

async function switchStep(ctx, zones, names, results) {
  const ready = [];
  for (const name of names) {
    try {
      const i = await inspect(ctx, zones, name);
      ctx.log(`== ${name}: ${i.oldHost} -> ${i.target}`);
      logState(ctx, 'Before', i);
      if (!i.site) {
        manualSteps(ctx, name, i.target, 'switch');
        results[name] = 'manual';
        continue;
      }
      const why = await readyToSwitch(ctx, i);
      if (why.length) {
        ctx.log(`::error::${name}: not switched: ${why.join('; ')}.`);
        results[name] = 'failed';
        continue;
      }
      ready.push(i);
    } catch (e) {
      ctx.log(`::error::${name}: ${e.message}`);
      results[name] = 'failed';
    }
  }
  if (ready.length === 0) return;

  // 1. The rule first: it does nothing until a record is proxied.
  ctx.log(`== redirect rule: ${ready.map((i) => i.oldHost).join(' ')}`);
  await ensureRedirectHosts({ add: ready.map((i) => i.name), dryRun: ctx.dryRun, env: ctx.env, fetchImpl: ctx.fetchImpl, log: (m) => ctx.log(`  ${m}`) });

  for (const i of ready) {
    try {
      ctx.log(`== ${i.name}: switch`);
      // 2. Proxy the old record: Cloudflare answers it with the 301 from now on.
      if (i.oldRec.proxied) ctx.log(`  DNS: ${i.oldHost} already proxied.`);
      else if (ctx.dryRun) ctx.log(`  DNS: would set ${i.oldHost} to proxied (content ${i.oldRec.content} unchanged).`);
      else {
        await ctx.cf(`/zones/${zones.old}/dns_records/${i.oldRec.id}`, { method: 'PATCH', body: JSON.stringify({ proxied: true }) });
        ctx.log(`  DNS: ${i.oldHost} is now proxied (content ${i.oldRec.content} unchanged).`);
      }
      // 3. hintwise primary, pisan.me alias gone.
      const aliases = (i.site.domain_aliases || []).filter((d) => d !== i.newHost && d !== i.oldHost);
      const done = i.site.custom_domain === i.newHost && !(i.site.domain_aliases || []).includes(i.oldHost);
      if (done) ctx.log(`  Netlify: ${i.newHost} already primary, no ${i.oldHost} alias.`);
      else if (ctx.dryRun) ctx.log(`  Netlify: would make ${i.newHost} primary of ${i.site.name}; aliases ${aliases.join(', ') || 'none'}.`);
      else {
        await ctx.netlify(`/sites/${i.site.id}`, { method: 'PATCH', body: JSON.stringify({ custom_domain: i.newHost, domain_aliases: aliases }) });
        ctx.log(`  Netlify: ${i.newHost} is now primary of ${i.site.name}; aliases ${aliases.join(', ') || 'none'}.`);
      }
      if (ctx.dryRun) {
        results[i.name] = 'dry-run';
        continue;
      }
      const after = await inspect(ctx, zones, i.name);
      logState(ctx, 'After', after);
      const p = await probe(ctx, `https://${i.oldHost}/hintwise-check?q=1`);
      const expected = `https://${i.newHost}/hintwise-check?q=1`;
      if (p.status === 301 && p.location === expected) ctx.log(`::notice::${i.name}: https://${i.oldHost}/... -> 301 ${p.location}`);
      else ctx.log(`::warning::${i.name}: https://${i.oldHost}/hintwise-check?q=1 gave ${p.status ?? p.error} ${p.location || ''}, expected 301 to ${expected} (Cloudflare can take a minute; check again).`);
      results[i.name] = 'ok';
    } catch (e) {
      ctx.log(`::error::${i.name}: ${e.message}`);
      results[i.name] = 'failed';
    }
  }
}

/** Run a step over `names`; returns { name: 'ok' | 'dry-run' | 'manual' | 'failed' }. */
export async function migrate({
  names, step, dryRun = true, env = process.env, fetchImpl = fetch, log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 30,
}) {
  if (!['hosts', 'switch'].includes(step)) throw new Error(`step must be hosts or switch, got ${step}`);
  const ctx = makeCtx({ env, fetchImpl, log, dryRun, sleep, attempts });
  log(`Step ${step}${dryRun ? ' (dry run: nothing changes)' : ''}: ${names.join(' ')}`);
  const results = {};
  const todo = [];
  for (const name of names) {
    if (RENDER_APPS[name]) {
      manualSteps(ctx, name, RENDER_APPS[name], step);
      results[name] = 'manual';
    } else todo.push(name);
  }
  const zones = {
    old: await zoneIdFor({ domain: `www.${OLD_DOMAIN}`, token: ctx.token, env, fetchImpl }),
    new: await zoneIdFor({ domain: `www.${APP_DOMAIN}`, token: ctx.token, env, fetchImpl }),
  };
  if (step === 'hosts') {
    for (const name of todo) {
      try {
        results[name] = await hostsStep(ctx, zones, name);
      } catch (e) {
        log(`::error::${name}: ${e.message}`);
        results[name] = 'failed';
      }
    }
  } else {
    await switchStep(ctx, zones, todo, results);
  }
  log(`Summary: ${Object.entries(results).map(([n, r]) => `${n}=${r}`).join(' ')}`);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const si = args.indexOf('--step');
  const step = si >= 0 ? args[si + 1] : undefined;
  const rest = args.filter((a, k) => a !== '--dry-run' && a !== '--step' && k !== si + 1);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const names = selectApps(rest, appsFromRepo(root));
  const results = await migrate({ names, step, dryRun });
  if (Object.values(results).includes('failed')) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.log(`::error::${e.message}`);
    process.exit(1);
  });
}
