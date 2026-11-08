#!/usr/bin/env node
/**
 * Render helpers for the hintwise.org move (docs/hintwise-migration.md).
 *   add-domain <service> <domain>      add a custom domain to a service
 *   set-env <service> <KEY> <value>    set one env var (others untouched)
 *   deploy <service>                   start a deploy
 *   show <service>                     print custom domains and env var names
 * Env: RENDER_API_KEY. Run by the "Render domain" workflow. Logs before/after.
 */
const API = 'https://api.render.com/v1';
const key = process.env.RENDER_API_KEY;
const die = (m) => { console.log(`::error::${m}`); process.exit(1); };
if (!key) die('RENDER_API_KEY is not set');
async function api(route, init = {}) {
  const res = await fetch(`${API}${route}`, { ...init, headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'content-type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const [cmd, name, a, b] = process.argv.slice(2);
const svcs = await api('/services?limit=100');
const svc = svcs.map((x) => x.service).find((s) => s.name === name);
if (!svc) die(`no Render service named ${name}`);
const domains = async () => (await api(`/services/${svc.id}/custom-domains?limit=50`)).map((d) => `${d.customDomain.name} (${d.customDomain.verificationStatus})`);
console.log(`Service ${svc.name} (${svc.id}); domains before: ${(await domains()).join(', ') || 'none'}`);
if (cmd === 'add-domain') {
  if (!/^[a-z0-9.-]+$/.test(a || '')) die('bad domain');
  try { await api(`/services/${svc.id}/custom-domains`, { method: 'POST', body: JSON.stringify({ name: a }) }); console.log(`Added ${a}.`); }
  catch (e) { if (String(e).includes('409') || /already/i.test(String(e))) console.log(`${a} already on ${name}.`); else throw e; }
  for (let i = 0; i < 30; i++) {
    const d = (await api(`/services/${svc.id}/custom-domains?limit=50`)).map((x) => x.customDomain).find((x) => x.name === a);
    if (d?.verificationStatus === 'verified') { console.log(`::notice::${a} verified on ${name}.`); break; }
    try { await api(`/services/${svc.id}/custom-domains/${encodeURIComponent(a)}/verify`, { method: 'POST' }); } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 10000));
  }
} else if (cmd === 'set-env') {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(a || '') || b === undefined) die('usage: set-env <service> <KEY> <value>');
  await api(`/services/${svc.id}/env-vars/${a}`, { method: 'PUT', body: JSON.stringify({ value: b }) });
  console.log(`Set ${a} on ${name} (value not printed).`);
} else if (cmd === 'deploy') {
  const d = await api(`/services/${svc.id}/deploys`, { method: 'POST', body: '{}' });
  console.log(`Deploy started: ${d.id || JSON.stringify(d).slice(0, 200)}`);
} else if (cmd !== 'show') die(`unknown command ${cmd}`);
console.log(`Domains after: ${(await domains()).join(', ') || 'none'}`);
if (cmd === 'show' || cmd === 'set-env') {
  const env = await api(`/services/${svc.id}/env-vars?limit=100`);
  console.log(`Env var names: ${env.map((e) => e.envVar.key).join(', ')}`);
}
