#!/usr/bin/env node
/**
 * Find env vars on every Netlify site and Render service whose value mentions
 * pisan.me (prints only names and the pisan.me host found, never full values),
 * and with --fix rewrite <x>.pisan.me -> its hintwise.org address
 * (scripts/domains.mjs) in those values, then rebuild/redeploy.
 * Skips td.pisan.me, chesstd.pisan.me (a second allowed origin is harmless), ypdsa.pisan.me and email addresses (@...pisan.me).
 * Env: NETLIFY_AUTH_TOKEN, RENDER_API_KEY.
 */
import { appDomainFor } from '../../scripts/domains.mjs';
const N = 'https://api.netlify.com/api/v1', R = 'https://api.render.com/v1';
const nt = process.env.NETLIFY_AUTH_TOKEN, rt = process.env.RENDER_API_KEY;
const fix = process.argv.includes('--fix');
const KEEP = new Set(['td.pisan.me', 'chesstd.pisan.me', 'ypdsa.pisan.me', 'pisan.me', 'www.pisan.me', 'yusuf.pisan.me', 'g.pisan.me', 'zoom.pisan.me']);
async function call(base, tok, route, init = {}) {
  const res = await fetch(`${base}${route}`, { ...init, headers: { authorization: `Bearer ${tok}`, accept: 'application/json', 'content-type': 'application/json' } });
  const t = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${route}: HTTP ${res.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}
const HOST = /(?<![@\w.-])([a-z0-9-]+\.)?pisan\.me\b/gi;
function rewrite(v) {
  const hosts = [];
  const out = v.replace(HOST, (h) => { const l = h.toLowerCase(); if (KEEP.has(l)) return h; hosts.push(l); return appDomainFor(l); });
  return { out, hosts };
}
let failed = 0;
const sites = [];
for (let p = 1; p <= 20; p++) { const b = await call(N, nt, `/sites?filter=all&per_page=100&page=${p}`); sites.push(...b); if (b.length < 100) break; }
for (const s of sites) {
  let env = [];
  try { env = await call(N, nt, `/accounts/${s.account_id}/env?site_id=${s.id}`); } catch { continue; }
  let changed = false;
  for (const e of env) {
    const vals = (e.values || []).map((v) => ({ ...v, ...rewrite(String(v.value ?? '')) }));
    const hit = vals.filter((v) => v.hosts.length);
    if (!hit.length) continue;
    console.log(`netlify ${s.name}: ${e.key} [${hit.map((v) => v.context).join(',')}] mentions ${[...new Set(hit.flatMap((v) => v.hosts))].join(', ')}`);
    if (!fix) continue;
    try {
      // PUT the whole variable: PATCH cannot set the "all" context.
      await call(N, nt, `/accounts/${s.account_id}/env/${e.key}?site_id=${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({ key: e.key, scopes: e.scopes, values: vals.map((v) => ({ context: v.context, value: v.out, ...(v.context_parameter ? { context_parameter: v.context_parameter } : {}) })) }),
      });
      console.log('  fixed'); changed = true;
    } catch (err) { failed++; console.log(`::error::${s.name} ${e.key}: ${String(err).slice(0, 200)}`); }
  }
  if (fix && changed && s.build_settings?.repo_url) {
    try { await call(N, nt, `/sites/${s.id}/builds`, { method: 'POST', body: '{}' }); console.log('  build started'); } catch (err) { failed++; console.log(`::error::${s.name} build: ${String(err).slice(0, 200)}`); }
  } else if (fix && changed) console.log('  no linked repo: redeploy from the Deploy workflow');
}
const svcs = (await call(R, rt, '/services?limit=100')).map((x) => x.service);
for (const s of svcs) {
  let env = [];
  try { env = (await call(R, rt, `/services/${s.id}/env-vars?limit=100`)).map((x) => x.envVar); } catch { continue; }
  let changed = false;
  for (const e of env) {
    const { out, hosts } = rewrite(String(e.value ?? ''));
    if (!hosts.length) continue;
    console.log(`render ${s.name}: ${e.key} mentions ${[...new Set(hosts)].join(', ')}`);
    if (!fix) continue;
    try { await call(R, rt, `/services/${s.id}/env-vars/${e.key}`, { method: 'PUT', body: JSON.stringify({ value: out }) }); console.log('  fixed'); changed = true; }
    catch (err) { failed++; console.log(`::error::${s.name} ${e.key}: ${String(err).slice(0, 200)}`); }
  }
  if (fix && changed) {
    try { await call(R, rt, `/services/${s.id}/deploys`, { method: 'POST', body: '{}' }); console.log('  deploy started'); } catch (err) { failed++; console.log(`::error::${s.name} deploy: ${String(err).slice(0, 200)}`); }
  }
}
if (failed) process.exit(1);
