#!/usr/bin/env node
/**
 * Point <host>.pisan.me at any target with a DNS-only CNAME, for sites hosted
 * outside Netlify (e.g. Render). Run by .github/workflows/set-cname.yml, since
 * the Cloudflare token exists only as a repo secret.
 *
 * - An existing CNAME for the name is updated in place; otherwise one is created.
 * - Any A or AAAA record for the name is deleted (a CNAME cannot share a name
 *   with other records).
 * - The record is always DNS only (not proxied).
 *
 * Usage: node set-cname.mjs <domain> <target>
 * Env: CLOUDFLARE_API_TOKEN (DNS edit), CLOUDFLARE_ZONE_ID (optional).
 */
import { zoneNameOf } from './cloudflare-dns.mjs';

const CF_API = 'https://api.cloudflare.com/client/v4';

async function cf(token, route, init = {}) {
  const res = await fetch(`${CF_API}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const why = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${init.method || 'GET'} ${route}: ${why}`);
  }
  return body.result;
}

const show = (r) => `${r.type} ${r.name} -> ${r.content}${r.proxied ? ' (proxied)' : ' (DNS only)'}`;

async function main() {
  const [domain, target] = process.argv.slice(2).map((s) => s?.trim().toLowerCase().replace(/\.$/, ''));
  if (!domain || !target) throw new Error('usage: set-cname.mjs <domain> <target>');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(target)) {
    throw new Error('domain and target must be plain host names');
  }
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  let zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    const zones = await cf(token, `/zones?name=${encodeURIComponent(zoneNameOf(domain))}`);
    zoneId = zones?.[0]?.id;
    if (!zoneId) throw new Error(`zone for ${domain} not found`);
  }
  const records = (await cf(token, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}`)) || [];
  console.log(`Before: ${records.length ? records.map(show).join('; ') : 'no records'}`);

  for (const r of records.filter((r) => r.type === 'A' || r.type === 'AAAA')) {
    await cf(token, `/zones/${zoneId}/dns_records/${r.id}`, { method: 'DELETE' });
    console.log(`Deleted ${show(r)}`);
  }
  const body = JSON.stringify({ type: 'CNAME', name: domain, content: target, proxied: false, ttl: 1 });
  const cname = records.find((r) => r.type === 'CNAME');
  const result = cname
    ? await cf(token, `/zones/${zoneId}/dns_records/${cname.id}`, { method: 'PATCH', body })
    : await cf(token, `/zones/${zoneId}/dns_records`, { method: 'POST', body });
  console.log(`${cname ? 'Updated' : 'Created'} ${show(result)}`);

  const after = (await cf(token, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}`)) || [];
  console.log(`After: ${after.map(show).join('; ')}`);
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
