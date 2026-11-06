#!/usr/bin/env node
/**
 * Give an existing Netlify site its <name>.pisan.me address without
 * redeploying it (a deploy costs Netlify credits; this does not):
 *   1. create the Cloudflare CNAME <name> -> <site>.netlify.app, DNS only
 *      (cloudflare-dns.mjs; an existing record is never changed),
 *   2. make the domain the site's primary custom domain (the old primary
 *      stays as a domain alias, still serving) and ask for its certificate,
 *   3. wait until https://<domain>/ answers.
 *
 *   node attach-domain.mjs <netlify-site-name> <domain>
 *
 * Env: NETLIFY_AUTH_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID (optional).
 * Run by the "Attach custom domain" workflow. The site's own repo should also
 * get the domain in its config, so a later deploy keeps it.
 */
import { ensureDomainDns } from './cloudflare-dns.mjs';

const [site, domain] = process.argv.slice(2);
const say = (level, msg) => console.log(level ? `::${level}::${msg}` : msg);
const die = (msg) => { say('error', msg); process.exit(1); };

if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site || '')) die(`bad Netlify site name: ${site}`);
if (!/^[a-z0-9][a-z0-9-]{0,62}\.pisan\.me$/.test(domain || '')) die(`domain must be <name>.pisan.me, got: ${domain}`);
if (!process.env.NETLIFY_AUTH_TOKEN) die('NETLIFY_AUTH_TOKEN is not set');
if (!process.env.CLOUDFLARE_API_TOKEN) die('CLOUDFLARE_API_TOKEN is not set');

async function netlify(route, init = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${route}`, {
    ...init,
    headers: { authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`, 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${route}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const target = `${site}.netlify.app`;
const info = await netlify(`/sites/${target}`).catch((e) => die(`no Netlify site ${target}: ${e.message}`));
say('', `Netlify site ${info.name} (${info.id}), custom domain now: ${info.custom_domain || 'none'}`);

const dns = await ensureDomainDns({ domain, target });
say(dns.warning ? 'warning' : 'notice', dns.message);
if (!dns.ready) die('DNS is not ready; nothing else changed');

if (info.custom_domain === domain) say('', `Custom domain already ${domain}.`);
else {
  // Keep the old primary domain as an alias so its links (and anything a
  // browser stored for that origin) keep working; a rename should not break it.
  const aliases = [...new Set([...(info.domain_aliases || []), ...(info.custom_domain ? [info.custom_domain] : [])])].filter((d) => d !== domain);
  await netlify(`/sites/${info.id}`, { method: 'PATCH', body: JSON.stringify({ custom_domain: domain, domain_aliases: aliases }) });
  say('notice', `Custom domain set to ${domain} (was ${info.custom_domain || 'none'}); aliases: ${aliases.join(', ') || 'none'}.`);
}
try {
  await netlify(`/sites/${info.id}/ssl`, { method: 'POST' });
  say('', 'Requested the TLS certificate.');
} catch (e) {
  say('', `Certificate request not accepted yet (Netlify retries on its own): ${String(e).slice(0, 200)}`);
}

for (let i = 1; i <= 30; i++) {
  try {
    const res = await fetch(`https://${domain}/`, { redirect: 'manual' });
    if (res.status < 400) { say('notice', `https://${domain}/ answers HTTP ${res.status}`); process.exit(0); }
  } catch { /* certificate or DNS not ready yet */ }
  await new Promise((r) => setTimeout(r, 10000));
}
die(`https://${domain}/ did not answer within 5 minutes; check the site's Domain management page in Netlify`);
