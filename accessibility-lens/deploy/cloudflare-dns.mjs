/* global process, fetch */
/**
 * Makes sure a Netlify app's custom domain (e.g. bombe-bench.hintwise.org) has
 * its DNS record before the deploy points the site at it.
 *
 * Why it matters: setting netlify.customDomain also writes a 301 from
 * <site>.netlify.app to the custom domain, so a custom domain with no DNS
 * record turns a working site into a dead link.
 *
 * With CLOUDFLARE_API_TOKEN set (a token limited to DNS edit on the zone), a
 * missing record is created: CNAME <host> -> <site>.netlify.app, DNS only,
 * because Netlify cannot issue its certificate through Cloudflare's proxy.
 * An existing record is never changed, only reported. Without the token, the
 * domain is used only if public DNS already answers for it.
 *
 * Zones (hintwise.org, pisan.me) are looked up by name, which needs
 * Zone:Read on each. CLOUDFLARE_ZONE_ID is only a fallback, used when the
 * lookup finds nothing and that id is the domain's zone (see zoneIdFor).
 */
import { OLD_DOMAIN } from '../../scripts/domains.mjs';

const CF_API = 'https://api.cloudflare.com/client/v4';
const DOH = 'https://cloudflare-dns.com/dns-query';

/** "bombe-bench.pisan.me" -> "pisan.me". Two-label zones only, which covers pisan.me and hintwise.org. */
export function zoneNameOf(domain) {
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length < 3) throw new Error(`${domain} is not a subdomain of a zone`);
  return labels.slice(-2).join('.');
}

/** Call the Cloudflare API; returns `result`. Errors carry the HTTP `status`. */
export async function cfApi(fetchImpl, token, route, init = {}) {
  const res = await fetchImpl(`${CF_API}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || body.success === false) {
    const why = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    const err = new Error(`Cloudflare API ${init.method || 'GET'} ${route}: ${why}`);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

/**
 * The Cloudflare zone id for `domain`, looked up by zone name. When the
 * lookup fails or finds nothing, CLOUDFLARE_ZONE_ID is used if it is that
 * zone: checked by reading the zone, or, when the token cannot read zones
 * (an older DNS-only token), assumed only for pisan.me, the zone that secret
 * was made for.
 */
export async function zoneIdFor({ domain, token, env = process.env, fetchImpl = fetch }) {
  const zone = zoneNameOf(domain);
  let lookupError;
  try {
    const zones = await cfApi(fetchImpl, token, `/zones?name=${encodeURIComponent(zone)}`);
    const id = (zones || []).find((z) => !z.name || z.name === zone)?.id;
    if (id) return id;
  } catch (e) {
    if (e.status !== 403 && e.status !== 401) throw e;
    lookupError = e;
  }
  const fallback = env.CLOUDFLARE_ZONE_ID;
  if (fallback) {
    let name;
    try {
      name = (await cfApi(fetchImpl, token, `/zones/${encodeURIComponent(fallback)}`))?.name;
    } catch {
      /* the token cannot read zones */
    }
    if (name === zone || (!name && zone === OLD_DOMAIN)) return fallback;
    if (name) throw new Error(`Cloudflare zone ${zone} not found for this token (CLOUDFLARE_ZONE_ID is ${name})`);
  }
  if (lookupError) throw lookupError;
  throw new Error(`Cloudflare zone ${zone} not found for this token`);
}

/** Every DNS record named exactly `name` in the zone. */
export async function dnsRecords({ zoneId, name, token, fetchImpl = fetch }) {
  return (await cfApi(fetchImpl, token, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`)) || [];
}

/** "CNAME a.pisan.me -> x.netlify.app (DNS only)" */
export const showRecord = (r) => `${r.type} ${r.name} -> ${r.content}${r.proxied ? ' (proxied)' : ' (DNS only)'}`;

/**
 * Should a site keep `oldDomain` (e.g. bombe-bench.pisan.me) as a Netlify
 * domain alias after its primary moves to hintwise.org? Only while the old
 * name still reaches Netlify directly: a DNS-only record. Once the record is
 * proxied, Cloudflare answers it with the redirect rule, and the alias must
 * go (Netlify could no longer renew a certificate that names it). With no
 * record at all there is nothing to keep. When Cloudflare cannot be asked,
 * the alias is kept, which never breaks a working address.
 */
export async function keepOldAlias({ oldDomain, env = process.env, fetchImpl = fetch }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) return { keep: true, reason: 'CLOUDFLARE_API_TOKEN is not set, so its DNS record cannot be checked' };
  try {
    const zoneId = await zoneIdFor({ domain: oldDomain, token, env, fetchImpl });
    const rec = (await dnsRecords({ zoneId, name: oldDomain, token, fetchImpl })).find((r) =>
      ['CNAME', 'A', 'AAAA'].includes(r.type),
    );
    if (!rec) return { keep: false, reason: 'it has no DNS record' };
    if (rec.proxied) return { keep: false, reason: 'its record is proxied, so Cloudflare answers it' };
    return { keep: true, reason: 'its record is still DNS only, so visitors still reach Netlify there' };
  } catch (e) {
    return { keep: true, reason: `its DNS record could not be checked: ${String(e.message || e).slice(0, 200)}` };
  }
}

/** True when public DNS answers for `domain` (CNAME or A). */
export async function resolves(domain, fetchImpl = fetch) {
  for (const type of ['CNAME', 'A']) {
    const res = await fetchImpl(`${DOH}?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!res.ok) continue;
    const body = await res.json();
    if (body.Status === 0 && (body.Answer || []).length > 0) return true;
  }
  return false;
}

/**
 * Decide whether the deploy may use `domain`, creating its CNAME when it can.
 * Returns { ready, action, message }: ready false means deploy on the
 * .netlify.app address only, with no custom domain and no redirect.
 */
export async function ensureDomainDns({ domain, target, env = process.env, fetchImpl = fetch }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    if (await resolves(domain, fetchImpl)) {
      return { ready: true, action: 'exists', message: `${domain} already resolves.` };
    }
    return {
      ready: false,
      action: 'missing',
      message:
        `${domain} has no DNS record and CLOUDFLARE_API_TOKEN is not set, so this deploy stays on ` +
        `${target} with no custom domain. Add CNAME ${domain.split('.')[0]} -> ${target} (DNS only) ` +
        `in Cloudflare, or set the token, then deploy again.`,
    };
  }

  const zoneId = await zoneIdFor({ domain, token, env, fetchImpl });
  const records = await dnsRecords({ zoneId, name: domain, token, fetchImpl });
  const existing = records.find((r) => ['CNAME', 'A', 'AAAA'].includes(r.type));
  if (existing) {
    const notes = [];
    if (existing.type !== 'CNAME' || existing.content.toLowerCase() !== target.toLowerCase()) {
      notes.push(`it points at ${existing.type} ${existing.content}, not ${target}; left unchanged`);
    }
    if (existing.proxied) notes.push('it is proxied, so Netlify cannot issue a certificate; switch it to DNS only');
    return {
      ready: true,
      action: 'exists',
      message: `${domain} already has a DNS record${notes.length ? `, but ${notes.join(' and ')}` : '.'}`,
      warning: notes.length > 0,
    };
  }

  await cfApi(fetchImpl, token, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name: domain,
      content: target,
      proxied: false,
      ttl: 1,
      comment: 'Created by the claude-built-apps deploy runner',
    }),
  });
  return { ready: true, action: 'created', message: `Created CNAME ${domain} -> ${target} (DNS only).` };
}
