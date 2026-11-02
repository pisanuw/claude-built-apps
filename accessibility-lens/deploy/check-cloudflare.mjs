#!/usr/bin/env node
/**
 * Read-only check of the Cloudflare secrets the deploy runner uses: is the
 * token active, and can it see the DNS record of a domain that already
 * exists? Writes nothing (an existing record is never changed by
 * ensureDomainDns). Run by the "Check Cloudflare token" workflow.
 *
 *   node check-cloudflare.mjs [domain]     # default bombe-bench.pisan.me
 */
import { ensureDomainDns } from './cloudflare-dns.mjs';

const domain = process.argv[2] || 'bombe-bench.pisan.me';
const token = process.env.CLOUDFLARE_API_TOKEN;
const say = (level, msg) => console.log(`::${level}::${msg}`);

if (!token) {
  say('error', 'CLOUDFLARE_API_TOKEN is not set.');
  process.exit(1);
}
say('notice', `CLOUDFLARE_ZONE_ID is ${process.env.CLOUDFLARE_ZONE_ID ? 'set' : 'not set (zone looked up by name)'}.`);

const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
  headers: { authorization: `Bearer ${token}` },
});
const body = await res.json().catch(() => ({}));
if (!res.ok || body.result?.status !== 'active') {
  say('error', `Token verify failed: HTTP ${res.status} ${JSON.stringify(body.errors || body.result || {})}`);
  process.exit(1);
}
say('notice', 'Token is active.');

try {
  const site = domain.split('.')[0];
  const dns = await ensureDomainDns({ domain, target: `${site}.netlify.app` });
  if (dns.action !== 'exists') {
    say('error', `Expected an existing record for ${domain}, got ${dns.action}: ${dns.message}`);
    process.exit(1);
  }
  say(dns.warning ? 'warning' : 'notice', `Token can read ${domain}'s DNS: ${dns.message}`);
} catch (e) {
  say('error', String(e));
  process.exit(1);
}
