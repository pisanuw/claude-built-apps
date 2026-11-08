#!/usr/bin/env node
/**
 * Google sign-in client switch (docs/google-oauth.md).
 *   list            print, for every Netlify site and Render service, the
 *                   names (never values) of env vars containing GOOGLE,
 *                   and for Netlify when and by whom each was last changed
 *   apply [--dry-run] set every such *_ID / CLIENT_ID var to
 *                   HINTWISE_AUTH_GOOGLE_ID and every *_SECRET var to
 *                   HINTWISE_AUTH_GOOGLE_SECRET, then trigger a build/deploy
 * Env: NETLIFY_AUTH_TOKEN, RENDER_API_KEY, HINTWISE_AUTH_GOOGLE_ID/SECRET.
 * Values are never printed.
 */
const N = 'https://api.netlify.com/api/v1', R = 'https://api.render.com/v1';
const nt = process.env.NETLIFY_AUTH_TOKEN, rt = process.env.RENDER_API_KEY;
const [cmd, flag] = process.argv.slice(2);
const dry = flag === '--dry-run';
async function call(base, tok, route, init = {}) {
  const res = await fetch(`${base}${route}`, { ...init, headers: { authorization: `Bearer ${tok}`, accept: 'application/json', 'content-type': 'application/json' } });
  const t = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${route}: HTTP ${res.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}
const isGoogle = (k) => /GOOGLE/.test(k) && /(CLIENT_ID|_ID|SECRET)$/.test(k) && !/REDIRECT|URI|PROJECT|ANALYTICS|API_KEY|MAPS/.test(k);
// yes / no / hidden (a secret Netlify will not return) / ? (secrets not given); never the value
const matches = (k, v) => (v === undefined || v === null || v === '' ? 'hidden' : !process.env.HINTWISE_AUTH_GOOGLE_ID ? '?' : v === valueFor(k) ? 'yes' : 'no');
const valueFor = (k) => (/SECRET$/.test(k) ? process.env.HINTWISE_AUTH_GOOGLE_SECRET : process.env.HINTWISE_AUTH_GOOGLE_ID);
if (cmd === 'apply' && (!process.env.HINTWISE_AUTH_GOOGLE_ID || !process.env.HINTWISE_AUTH_GOOGLE_SECRET)) {
  console.log('::error::HINTWISE_AUTH_GOOGLE_ID and HINTWISE_AUTH_GOOGLE_SECRET secrets are not set'); process.exit(1);
}
let failed = 0;
// Netlify
const sites = [];
for (let p = 1; p <= 20; p++) { const b = await call(N, nt, `/sites?filter=all&per_page=100&page=${p}`); sites.push(...b); if (b.length < 100) break; }
for (const s of sites) {
  let envs = [];
  try { envs = (await call(N, nt, `/accounts/${s.account_id}/env?site_id=${s.id}`)).filter((e) => isGoogle(e.key)); }
  catch (e) { console.log(`netlify ${s.name}: cannot read env (${String(e).slice(0, 120)})`); continue; }
  const keys = envs.map((e) => e.key);
  if (!keys.length) continue;
  console.log(`netlify ${s.name}: ${keys.join(', ')}`);
  if (cmd !== 'apply') {
    // who last changed each var, and when (never the value)
    for (const e of envs) {
      const ctx = (e.values || []).map((v) => `${v.context}${v.context_parameter ? ':' + v.context_parameter : ''}=${matches(e.key, v.value)}`).join(' ');
      console.log(`  ${e.key}: updated ${e.updated_at || '?'} by ${e.updated_by?.full_name || e.updated_by?.email || '?'}; ${e.is_secret ? 'secret' : 'plain'}; level ${e.site_id ? 'site' : 'shared'}; HintWise? ${ctx || 'no values'}`);
    }
    continue;
  }
  for (const k of keys) {
    if (dry) { console.log(`  would set ${k}`); continue; }
    try {
      await call(N, nt, `/accounts/${s.account_id}/env/${k}?site_id=${s.id}`, { method: 'PUT', body: JSON.stringify({ key: k, scopes: ['builds', 'functions', 'runtime', 'post-processing'], values: [{ context: 'all', value: valueFor(k) }] }) });
      console.log(`  set ${k}`);
    } catch (e) { failed++; console.log(`::error::netlify ${s.name} ${k}: ${String(e).slice(0, 200)}`); }
  }
  if (!dry && s.build_settings?.repo_url) {
    try { await call(N, nt, `/sites/${s.id}/builds`, { method: 'POST', body: '{}' }); console.log('  build started'); }
    catch (e) { failed++; console.log(`::error::netlify ${s.name} build: ${String(e).slice(0, 200)}`); }
  } else if (!dry) console.log('  no linked repo: redeploy it from this repo\'s Deploy workflow');
}
// Render
const svcs = (await call(R, rt, '/services?limit=100')).map((x) => x.service);
for (const s of svcs) {
  let keys = [];
  let rvars = [];
  try { rvars = (await call(R, rt, `/services/${s.id}/env-vars?limit=100`)).map((e) => e.envVar).filter((e) => isGoogle(e.key)); } catch { continue; }
  keys = rvars.map((e) => e.key);
  if (!keys.length) continue;
  console.log(`render ${s.name}: ${keys.join(', ')}`);
  if (cmd !== 'apply') {
    for (const e of rvars) console.log(`  ${e.key}: HintWise? ${matches(e.key, e.value)}`);
    continue;
  }
  for (const k of keys) {
    if (dry) { console.log(`  would set ${k}`); continue; }
    try { await call(R, rt, `/services/${s.id}/env-vars/${k}`, { method: 'PUT', body: JSON.stringify({ value: valueFor(k) }) }); console.log(`  set ${k}`); }
    catch (e) { failed++; console.log(`::error::render ${s.name} ${k}: ${String(e).slice(0, 200)}`); }
  }
  if (!dry) {
    try { await call(R, rt, `/services/${s.id}/deploys`, { method: 'POST', body: '{}' }); console.log('  deploy started'); }
    catch (e) { failed++; console.log(`::error::render ${s.name} deploy: ${String(e).slice(0, 200)}`); }
  }
}
if (failed) process.exit(1);
