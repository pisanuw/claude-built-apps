#!/usr/bin/env node
/**
 * Remove a custom domain from a Netlify site, as its primary domain or an
 * alias. Deploys nothing and leaves DNS alone. If the domain was the primary,
 * no other alias is promoted (Netlify sends <site>.netlify.app to the primary,
 * and an alias may have no DNS), so the site stays on <site>.netlify.app plus
 * its remaining aliases.
 *
 *   node remove-domain.mjs <netlify-site-name> <domain>
 *
 * Env: NETLIFY_AUTH_TOKEN. Run by the "Remove Netlify domain" workflow.
 */
const [site, domain] = process.argv.slice(2).map((s) => s?.trim().toLowerCase());
const die = (msg) => { console.log(`::error::${msg}`); process.exit(1); };

if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site || '')) die(`bad Netlify site name: ${site}`);
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain || '')) die(`bad domain: ${domain}`);
if (!process.env.NETLIFY_AUTH_TOKEN) die('NETLIFY_AUTH_TOKEN is not set');

async function netlify(route, init = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${route}`, {
    ...init,
    headers: { authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`, 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${route}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const show = (s) => `primary ${s.custom_domain || 'none'}; aliases ${(s.domain_aliases || []).join(', ') || 'none'}`;
let info = await netlify(`/sites/${site}.netlify.app`).catch(() => null);
if (!info) {
  // The named site is gone or renamed: look for the domain on every site in the account.
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await netlify(`/sites?filter=all&per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  info = all.find((s) => s.custom_domain === domain || (s.domain_aliases || []).includes(domain));
  if (!info) {
    console.log(`::notice::No Netlify site named ${site}, and none of the ${all.length} sites in the account has ${domain}; nothing to do.`);
    process.exit(0);
  }
  console.log(`::warning::No site named ${site}; ${domain} is on ${info.name}, removing it there.`);
}
console.log(`Before: ${show(info)}`);

const aliases = info.domain_aliases || [];
if (info.custom_domain !== domain && !aliases.includes(domain)) {
  console.log(`::notice::${domain} is not on ${site}; nothing to do.`);
  process.exit(0);
}
const patch = { domain_aliases: aliases.filter((d) => d !== domain) };
if (info.custom_domain === domain) patch.custom_domain = null;
const after = await netlify(`/sites/${info.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
console.log(`After: ${show(after)}`);
if (after.custom_domain === domain || (after.domain_aliases || []).includes(domain)) die(`${domain} is still on ${site}`);
console.log(`::notice::Removed ${domain} from ${site}.`);
