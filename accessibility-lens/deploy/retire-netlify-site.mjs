#!/usr/bin/env node
/**
 * Retire one app's Netlify hosting: delete the Netlify site, then delete the
 * Cloudflare CNAME that the deploy created for it (<site>.hintwise.org, and
 * <site>.pisan.me if one exists), but only a CNAME that points at
 * <site>.netlify.app. Anything else on those names is left alone and reported.
 *
 *   node retire-netlify-site.mjs <netlify-site-name> <same name again>
 *
 * Refuses while <site>/deploy/target.yml exists in the repo (the app would
 * come back on its next deploy, and a still-deployed app must not be removed
 * by a typo), and when the two names differ.
 *
 * Env: NETLIFY_AUTH_TOKEN, CLOUDFLARE_API_TOKEN (CLOUDFLARE_ZONE_ID optional).
 * Run by the "Retire Netlify site" workflow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfApi, dnsRecords, showRecord, zoneIdFor } from './cloudflare-dns.mjs';
import { APP_DOMAIN, OLD_DOMAIN } from '../../scripts/domains.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Checks the inputs; returns an error message or null. */
export function refusal(site, confirm, root = ROOT) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(site || '')) return `bad Netlify site name: ${site}`;
  if (confirm !== site) return `the confirmation (${confirm}) does not match the site name (${site})`;
  if (fs.existsSync(path.join(root, site, 'deploy', 'target.yml'))) return `${site}/deploy/target.yml still exists: remove it (and push) before retiring the site`;
  return null;
}

/** The CNAMEs to delete on one name: only those pointing at <site>.netlify.app. */
export function recordsToDelete(records, site) {
  const target = `${site}.netlify.app`;
  const del = records.filter((r) => r.type === 'CNAME' && String(r.content).toLowerCase().replace(/\.$/, '') === target);
  return { del, keep: records.filter((r) => !del.includes(r)) };
}

export async function retire({ site, env = process.env, fetchImpl = fetch, log = console.log }) {
  const netlify = async (route, init = {}) => {
    const res = await fetchImpl(`https://api.netlify.com/api/v1${route}`, { ...init, headers: { authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}`, 'content-type': 'application/json' } });
    const text = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${route}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  const info = await netlify(`/sites/${site}.netlify.app`);
  if (!info) log(`::notice::No Netlify site ${site}.netlify.app; nothing to delete there.`);
  else {
    if (info.name !== site) throw new Error(`${site}.netlify.app resolved to site ${info.name}; refusing`);
    log(`Netlify site ${info.name} (${info.id}): primary ${info.custom_domain || 'none'}; aliases ${(info.domain_aliases || []).join(', ') || 'none'}`);
    await netlify(`/sites/${info.id}`, { method: 'DELETE' });
    if (await netlify(`/sites/${info.id}`)) throw new Error(`Netlify site ${site} still exists after DELETE`);
    log(`::notice::Deleted Netlify site ${site}.`);
  }
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    log('::warning::CLOUDFLARE_API_TOKEN is not set; DNS records were not checked.');
    return;
  }
  for (const name of [`${site}.${APP_DOMAIN}`, `${site}.${OLD_DOMAIN}`]) {
    let zoneId;
    let records;
    try {
      zoneId = await zoneIdFor({ domain: name, token, env, fetchImpl });
      records = await dnsRecords({ zoneId, name, token, fetchImpl });
    } catch (e) {
      // The old zone may be out of this token's reach; the app's own name is not.
      if (name.endsWith(`.${APP_DOMAIN}`)) throw e;
      log(`::warning::Could not read DNS for ${name}: ${e.message}`);
      continue;
    }
    const { del, keep } = recordsToDelete(records, site);
    for (const r of del) {
      await cfApi(fetchImpl, token, `/zones/${zoneId}/dns_records/${r.id}`, { method: 'DELETE' });
      log(`::notice::Deleted DNS ${showRecord(r)}.`);
    }
    for (const r of keep) log(`::warning::Left DNS ${showRecord(r)} alone (not a CNAME to ${site}.netlify.app).`);
    if (!del.length && !keep.length) log(`No DNS record for ${name}.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [site, confirm] = process.argv.slice(2).map((s) => s?.trim().toLowerCase());
  const why = refusal(site, confirm);
  if (why) {
    console.log(`::error::${why}`);
    process.exit(1);
  }
  if (!process.env.NETLIFY_AUTH_TOKEN) {
    console.log('::error::NETLIFY_AUTH_TOKEN is not set');
    process.exit(1);
  }
  try {
    await retire({ site });
  } catch (e) {
    console.log(`::error::${String(e.message || e).slice(0, 500)}`);
    process.exit(1);
  }
}
