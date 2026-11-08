#!/usr/bin/env node
/**
 * Read-only: print every DNS record in a Cloudflare zone (type, name,
 * content, proxied). Writes nothing. Run by the "List DNS" workflow.
 *
 *   node list-dns.mjs [zone-name]   (default: the zone in CLOUDFLARE_ZONE_ID)
 *
 * Env: CLOUDFLARE_API_TOKEN; CLOUDFLARE_ZONE_ID used when no zone name is given.
 */
const CF = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.log('::error::CLOUDFLARE_API_TOKEN is not set'); process.exit(1); }
async function cf(route) {
  const res = await fetch(`${CF}${route}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(`${route}: ${(body.errors || []).map((e) => e.message).join('; ') || res.status}`);
  return body;
}
const zoneName = (process.argv[2] || '').trim();
let zoneId = process.env.CLOUDFLARE_ZONE_ID;
if (zoneName) {
  const z = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
  zoneId = z.result?.[0]?.id;
  if (!zoneId) { console.log(`::error::zone ${zoneName} not visible to this token`); process.exit(1); }
}
const rows = [];
for (let page = 1; page <= 50; page++) {
  const b = await cf(`/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
  rows.push(...b.result);
  if (page >= (b.result_info?.total_pages || 1)) break;
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
console.log(`${rows.length} records`);
for (const r of rows) console.log(`${r.type}\t${r.name}\t${r.type === 'TXT' ? '(txt)' : r.content}\t${r.proxied ? 'proxied' : 'dns-only'}`);
