#!/usr/bin/env node
/**
 * Read-only: list every Netlify site (name, URL, custom domain, aliases, repo)
 * and every Render service (name, URL, custom domains, repo). Writes nothing.
 * Env: NETLIFY_AUTH_TOKEN, RENDER_API_KEY. Run by the "List hosts" workflow.
 */
async function get(url, token) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
if (process.env.NETLIFY_AUTH_TOKEN) {
  const sites = [];
  for (let page = 1; page <= 20; page++) {
    const b = await get(`https://api.netlify.com/api/v1/sites?filter=all&per_page=100&page=${page}`, process.env.NETLIFY_AUTH_TOKEN);
    sites.push(...b);
    if (b.length < 100) break;
  }
  console.log(`## Netlify: ${sites.length} sites`);
  for (const s of sites.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`netlify\t${s.name}\t${s.custom_domain || '-'}\t${(s.domain_aliases || []).join(',') || '-'}\t${s.build_settings?.repo_url || '-'}`);
  }
}
if (process.env.RENDER_API_KEY) {
  const svcs = await get('https://api.render.com/v1/services?limit=100', process.env.RENDER_API_KEY);
  console.log(`## Render: ${svcs.length} services`);
  for (const { service: s } of svcs) {
    let domains = '-';
    try {
      const d = await get(`https://api.render.com/v1/services/${s.id}/custom-domains?limit=50`, process.env.RENDER_API_KEY);
      domains = d.map((x) => x.customDomain.name).join(',') || '-';
    } catch { /* not a web service */ }
    console.log(`render\t${s.name}\t${s.serviceDetails?.url || '-'}\t${domains}\t${s.repo || '-'}`);
  }
}
