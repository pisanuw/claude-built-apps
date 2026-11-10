#!/usr/bin/env node
/**
 * Look at, or fix, the address-type environment variables of one Netlify site
 * (sites this repo does not deploy, such as PasteMD and UpvoteMe).
 *
 *   node netlify-env.mjs show --site paste-md
 *       the site's primary domain, aliases and every env var: its name,
 *       whether it is secret, its contexts, and its value only when the value
 *       is a plain http(s) URL (anything else prints as "set"; secret values
 *       cannot be read at all)
 *   node netlify-env.mjs set --site upvoteme --key NEXTAUTH_URL --value https://upvoteme.netlify.app [--build]
 *       write KEY as a plain (not secret) variable in every context. A secret
 *       variable cannot be unmarked on Netlify, so an existing secret one is
 *       deleted and re-created as plain. Only http(s) URL values are accepted:
 *       this is for addresses, never for secrets (the value is visible in the
 *       workflow's inputs). --build starts a build of the linked repo.
 *
 * Env: NETLIFY_AUTH_TOKEN. Run it from the "Netlify env" workflow.
 */

/** Pure: a value is printable when it is an http(s) URL with no credentials. */
export function isPrintableUrl(v) {
  if (typeof v !== 'string' || !/^https?:\/\/[^\s@]+$/i.test(v)) return false;
  try {
    const u = new URL(v);
    return !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Pure: one line describing an env var, never showing a non-URL value. */
export function describeVar(e) {
  const values = (e.values || []).map((v) => {
    const ctx = `${v.context}${v.context_parameter ? ':' + v.context_parameter : ''}`;
    if (e.is_secret) return `${ctx}=secret`;
    if (v.value === undefined || v.value === null || v.value === '') return `${ctx}=empty`;
    return `${ctx}=${isPrintableUrl(v.value) ? v.value : 'set'}`;
  });
  return `${e.key}: ${e.is_secret ? 'secret' : 'plain'}; scopes ${(e.scopes || []).join('+') || '?'}; ${values.join(' ') || 'no values'}`;
}

/** Pure: the PUT/POST body for a plain variable in every context. */
export function plainVarBody(key, value) {
  return { key, scopes: ['builds', 'functions', 'runtime', 'post_processing'], is_secret: false, values: [{ context: 'all', value }] };
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const cmd = process.argv[2];
  const site = arg('site');
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!['show', 'set'].includes(cmd) || !site) throw new Error('usage: netlify-env.mjs show|set --site <name> [--key K --value URL] [--build]');
  if (!/^[a-z0-9-]+$/.test(site)) throw new Error(`bad site name: ${site}`);
  if (!token) throw new Error('NETLIFY_AUTH_TOKEN is not set');

  const netlify = async (route, init = {}) => {
    const res = await fetch(`https://api.netlify.com/api/v1${route}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${route} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };

  const info = await netlify(`/sites/${site}.netlify.app`);
  const envRoute = `/accounts/${info.account_id}/env`;
  const list = async () => netlify(`${envRoute}?site_id=${info.id}`);
  console.log(`Site ${info.name}: primary ${info.custom_domain || 'none'}; aliases ${(info.domain_aliases || []).join(', ') || 'none'}; url ${info.url}; ssl_url ${info.ssl_url}`);

  if (cmd === 'show') {
    const envs = await list();
    console.log(`${envs.length} env var(s):`);
    for (const e of envs.sort((a, b) => a.key.localeCompare(b.key))) console.log(`  ${describeVar(e)}`);
    // Env changes reach functions only with a new deploy, so show the last few.
    const deploys = await netlify(`/sites/${info.id}/deploys?per_page=5`);
    console.log('Recent deploys:');
    for (const d of deploys) {
      const live = d.id === info.published_deploy?.id ? ' (live)' : '';
      console.log(`  ${d.created_at} ${d.state}${live} ${d.context || ''} ${d.error_message ? '- ' + String(d.error_message).slice(0, 200) : ''}`);
    }
    return;
  }

  const key = arg('key');
  const value = arg('value');
  if (!key || !/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`bad key: ${key}`);
  if (!isPrintableUrl(value)) throw new Error('set only takes an http(s) URL value (addresses, never secrets)');
  const existing = (await list()).find((e) => e.key === key);
  const q = `?site_id=${info.id}`;
  if (existing?.is_secret) {
    await netlify(`${envRoute}/${key}${q}`, { method: 'DELETE' });
    console.log(`Deleted secret ${key} (Netlify cannot unmark a secret).`);
  }
  if (existing && !existing.is_secret) {
    await netlify(`${envRoute}/${key}${q}`, { method: 'PUT', body: JSON.stringify(plainVarBody(key, value)) });
  } else {
    await netlify(`${envRoute}${q}`, { method: 'POST', body: JSON.stringify([plainVarBody(key, value)]) });
  }
  const after = (await list()).find((e) => e.key === key);
  if (!after || after.is_secret || !(after.values || []).some((v) => v.value === value))
    throw new Error(`${key} did not come back as plain with the new value`);
  console.log(`Set ${describeVar(after)}`);
  if (process.argv.includes('--build')) {
    if (!info.build_settings?.repo_url) console.log('::warning::no linked repo, so no build started');
    else {
      await netlify(`/sites/${info.id}/builds`, { method: 'POST', body: '{}' });
      console.log('Build started.');
    }
  }
}

if (process.env.NETLIFY_ENV_NO_RUN !== '1') {
  main().catch((e) => {
    console.log(`::error::${String(e.message || e).slice(0, 400)}`);
    process.exit(1);
  });
}
