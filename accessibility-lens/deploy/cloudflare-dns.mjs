/**
 * Makes sure a Netlify app's custom domain (e.g. bombe-bench.pisan.me) has
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
 * CLOUDFLARE_ZONE_ID skips the zone lookup (which needs Zone:Read).
 */

const CF_API = 'https://api.cloudflare.com/client/v4';
const DOH = 'https://cloudflare-dns.com/dns-query';

/** "bombe-bench.pisan.me" -> "pisan.me". Two-label zones only, which covers pisan.me. */
export function zoneNameOf(domain) {
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length < 3) throw new Error(`${domain} is not a subdomain of a zone`);
  return labels.slice(-2).join('.');
}

async function cfApi(fetchImpl, token, route, init = {}) {
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
    throw new Error(`Cloudflare API ${init.method || 'GET'} ${route}: ${why}`);
  }
  return body.result;
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

  let zoneId = env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    const zone = zoneNameOf(domain);
    const zones = await cfApi(fetchImpl, token, `/zones?name=${encodeURIComponent(zone)}`);
    zoneId = zones?.[0]?.id;
    if (!zoneId) throw new Error(`Cloudflare zone ${zone} not found for this token`);
  }

  const records = await cfApi(
    fetchImpl,
    token,
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}`,
  );
  const existing = (records || []).find((r) => ['CNAME', 'A', 'AAAA'].includes(r.type));
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
