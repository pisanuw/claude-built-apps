#!/usr/bin/env node
/**
 * Config-driven deploy runner.
 *
 * Reads deploy/target.yml and provisions + deploys the app to the chosen host
 * (Render or Netlify), creating the project if it does not exist yet. Intended
 * to run inside the GitHub Actions "deploy" workflow, where the provider tokens
 * are present as environment variables sourced from GitHub repo secrets.
 *
 * No secret ever appears in this file or in target.yml. Tokens are read from
 * the environment only:
 *   - Render:  RENDER_API_KEY
 *   - Netlify: NETLIFY_AUTH_TOKEN
 *   - Custom domains: CLOUDFLARE_API_TOKEN (optional, DNS edit and Zone:Read on
 *     hintwise.org and pisan.me) and CLOUDFLARE_ZONE_ID (optional fallback);
 *     see cloudflare-dns.mjs
 *
 * netlify.customDomain in target.yml still says <app>.pisan.me; the address
 * actually used is appDomainFor() of it (scripts/domains.mjs), i.e.
 * <app>.hintwise.org, so no target.yml needs editing for the move.
 *
 * Usage:
 *   node deploy.mjs                 # real deploy
 *   node deploy.mjs --dry-run       # print the plan, make no API calls
 *   node deploy.mjs --config path   # use a different control file
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { injectFooterIntoDir } from '../../scripts/site-footer.mjs';
import { ensureDomainDns, keepOldAlias, resolves } from './cloudflare-dns.mjs';
import { appDomainFor, oldDomainFor } from '../../scripts/domains.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const configPath = readFlag('--config') ?? defaultConfigPath();

function readFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

function defaultConfigPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'target.yml');
}

function log(...m) {
  console.log('[deploy]', ...m);
}

/** Emit a GitHub Actions error annotation (readable via the API, unlike logs). */
function ghError(message) {
  const escaped = String(message)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  console.log(`::error title=deploy::${escaped}`);
}

function fail(message) {
  ghError(message);
  console.error('[deploy] ERROR:', message);
  process.exit(1);
}

/** Emit a GitHub Actions notice annotation (readable via the API). */
function ghNotice(message) {
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::notice title=deploy-url::${escaped}`);
}

/** Load and validate the control file. */
function loadConfig() {
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    fail(`Could not read control file at ${configPath}`);
  }
  const cfg = parse(raw) ?? {};

  if (!['render', 'netlify'].includes(cfg.provider)) {
    fail(`"provider" must be "render" or "netlify" (got: ${JSON.stringify(cfg.provider)})`);
  }
  for (const field of ['projectName', 'directory']) {
    if (!cfg[field] || typeof cfg[field] !== 'string') {
      fail(`"${field}" is required and must be a string`);
    }
  }
  cfg.envPassthrough = Array.isArray(cfg.envPassthrough) ? cfg.envPassthrough : [];
  cfg.envRemove = Array.isArray(cfg.envRemove) ? cfg.envRemove : [];
  return cfg;
}

/** Collect env to forward: literal `env` map (non-secret) plus the values of
 *  the secret names listed in `envPassthrough` that are actually set. */
function collectEnv(cfg) {
  const out = {};
  // Literal, non-secret values declared directly in the control file.
  if (cfg.env && typeof cfg.env === 'object') {
    for (const [k, v] of Object.entries(cfg.env)) {
      if (v !== null && v !== undefined && String(v).length > 0) out[k] = String(v);
    }
  }
  for (const name of cfg.envPassthrough) {
    const value = process.env[name];
    if (value && value.length > 0) out[name] = value;
    else log(`note: passthrough env "${name}" is not set; skipping it`);
  }
  return out;
}

/** Best-effort https repo URL from the local git remote. */
function gitRemoteUrl() {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
    }).trim();
    return url
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\/\/[^@/]+@/, '//') // strip any embedded user:token@ credentials
      .replace(/\.git$/, '');
  } catch {
    return '';
  }
}

// --------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------

const RENDER_API = 'https://api.render.com/v1';

async function renderFetch(token, route, init = {}) {
  const res = await fetch(`${RENDER_API}${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Render API ${route} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

async function deployRender(cfg) {
  const token = process.env.RENDER_API_KEY;
  const r = cfg.render ?? {};
  const repo = r.repo || cfg.repo || gitRemoteUrl();
  const desiredEnv = collectEnv(cfg);
  const envVars = Object.entries(desiredEnv).map(([key, value]) => ({ key, value }));
  // render.generateEnv: keys the service cannot boot without. When no
  // passthrough value is present (repo secret unset), generate a random value
  // once instead of shipping a service that crash-loops on startup.
  const generateKeys = (r.generateEnv ?? []).filter((k) => !(k in desiredEnv));

  const plan = {
    action: 'create-if-missing then deploy',
    name: cfg.projectName,
    type: 'web_service',
    repo,
    branch: r.branch ?? 'main',
    rootDir: cfg.directory,
    region: r.region ?? 'oregon',
    servicePlan: r.plan ?? 'free',
    buildCommand: cfg.build,
    startCommand: r.startCommand ?? 'npm start',
    healthCheckPath: r.healthCheckPath ?? '/api/health',
    envVarsForwarded: envVars.map((e) => e.key),
    envVarsGenerated: generateKeys,
  };
  log('Render plan:\n' + JSON.stringify(plan, null, 2));

  if (DRY_RUN) {
    log('dry-run: no Render API calls made.');
    return;
  }
  if (!token) fail('RENDER_API_KEY is not set in the environment.');
  if (!repo) fail('Could not determine the repo URL; set render.repo in target.yml.');

  // Resolve the owning workspace.
  let ownerId = r.ownerId;
  if (!ownerId) {
    const owners = await renderFetch(token, '/owners?limit=1');
    ownerId = owners?.[0]?.owner?.id;
    if (!ownerId) fail('Could not resolve a Render workspace (ownerId). Set render.ownerId.');
    log(`Using Render workspace ${ownerId}`);
  }

  // Find an existing service by name.
  const existing = await renderFetch(
    token,
    `/services?name=${encodeURIComponent(cfg.projectName)}&type=web_service&limit=1`,
  );
  const found = existing?.[0]?.service;

  if (found) {
    log(`Service "${cfg.projectName}" exists (${found.id}); syncing env then triggering a deploy.`);
    // render.plan is applied on create; for an existing service, bring the
    // instance type in line with target.yml too (owner, 10 Nov 2026: backend-hub
    // moves from free to starter). A refused change warns and the deploy goes on.
    const wantPlan = r.plan ?? 'free';
    const havePlan = found.serviceDetails?.plan;
    if (havePlan && havePlan !== wantPlan) {
      log(`Changing the Render plan of "${cfg.projectName}" from ${havePlan} to ${wantPlan}.`);
      try {
        await renderFetch(token, `/services/${found.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ serviceDetails: { plan: wantPlan } }),
        });
        const after = await renderFetch(token, `/services/${found.id}`);
        log(`Render plan now: ${after?.serviceDetails?.plan ?? '(not reported)'}`);
      } catch (e) {
        console.log(`::warning::Could not change the Render plan of ${cfg.projectName} to ${wantPlan}: ${String(e.message || e).slice(0, 300)}`);
      }
    } else {
      log(`Render plan: ${havePlan ?? '(not reported)'}${havePlan ? ' (as wanted)' : ''}`);
    }
    await ensureRenderEnv(token, found.id, desiredEnv, generateKeys);
    const deploy = await renderFetch(token, `/services/${found.id}/deploys`, {
      method: 'POST',
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
    });
    log(`Deploy triggered: ${deploy?.id ?? '(no id)'} status=${deploy?.status ?? 'queued'}`);
    const url = found.serviceDetails?.url;
    if (url) {
      ghNotice(`${cfg.projectName} (render): ${url}`);
      await verifyRenderHealth(url, r.healthCheckPath ?? '/api/health', cfg.projectName);
    }
    return;
  }

  log(`Service "${cfg.projectName}" not found; creating it.`);
  for (const key of generateKeys) {
    log(`Generating env ${key} for the new service (no passthrough value was set).`);
    envVars.push({ key, value: randomBytes(32).toString('hex') });
  }
  const created = await renderFetch(token, '/services', {
    method: 'POST',
    body: JSON.stringify({
      type: 'web_service',
      name: cfg.projectName,
      ownerId,
      repo,
      branch: r.branch ?? 'main',
      autoDeploy: 'yes',
      rootDir: cfg.directory,
      envVars,
      serviceDetails: {
        env: r.runtime ?? 'node',
        region: r.region ?? 'oregon',
        plan: r.plan ?? 'free',
        healthCheckPath: r.healthCheckPath ?? '/api/health',
        envSpecificDetails: {
          buildCommand: cfg.build,
          startCommand: r.startCommand ?? 'npm start',
        },
      },
    }),
  });
  const svc = created?.service ?? created;
  log(`Created service ${svc?.id ?? '(unknown id)'}. Render will build and deploy it.`);
  const createdUrl = svc?.serviceDetails?.url;
  if (createdUrl) {
    ghNotice(`${cfg.projectName} (render): ${createdUrl}`);
    await verifyRenderHealth(createdUrl, r.healthCheckPath ?? '/api/health', cfg.projectName);
  }
}

/**
 * Bring an existing service's env vars in line with target.yml: upsert every
 * declared/passthrough var (previously env was only applied at creation, so
 * config changes never reached live services), then generate any
 * `render.generateEnv` key the service is still missing.
 */
async function ensureRenderEnv(token, serviceId, desired, generateKeys) {
  for (const [key, value] of Object.entries(desired)) {
    await renderFetch(token, `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }
  if (generateKeys.length === 0) return;
  const current = await renderFetch(token, `/services/${serviceId}/env-vars?limit=100`);
  const present = new Set((current ?? []).map((e) => e?.envVar?.key).filter(Boolean));
  for (const key of generateKeys) {
    if (present.has(key)) continue;
    log(`Generating missing env ${key} on the service (no passthrough value was set).`);
    await renderFetch(token, `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: randomBytes(32).toString('hex') }),
    });
  }
}

/**
 * Poll the live health endpoint until Render finishes building (best-effort,
 * like the Netlify page/health checks: an error annotation, not a job
 * failure). Render builds take minutes, so this waits up to ~10 minutes.
 */
async function verifyRenderHealth(baseUrl, healthPath, projectName) {
  const target = `${baseUrl.replace(/\/$/, '')}${healthPath}`;
  const attempts = 40;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(target, { headers: { accept: 'application/json' } });
      const body = (await res.text()).slice(0, 200);
      if (res.ok && body.includes('"status"')) {
        ghNotice(`${projectName} health OK: ${target} -> ${res.status} ${body}`);
        return;
      }
      if (attempt === attempts) {
        ghError(
          `${projectName}: ${target} still not healthy after ~10min ` +
            `(HTTP ${res.status}). The Render build may have failed; check the dashboard. ` +
            `Body started: ${body}`,
        );
        return;
      }
    } catch (e) {
      if (attempt === attempts) {
        ghError(`${projectName} health check could not reach ${target}: ${String(e).slice(0, 160)}`);
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

// --------------------------------------------------------------------------
// Netlify
// --------------------------------------------------------------------------

function netlify(argv, opts = {}) {
  try {
    return execFileSync('npx', ['--yes', 'netlify-cli@latest', ...argv], {
      encoding: 'utf8',
      // Capture stderr always so failures carry the real CLI message; stream
      // stdout to the log unless the caller needs to parse it.
      stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'pipe'],
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const detail = [e.stdout, e.stderr]
      .filter(Boolean)
      .map(String)
      .join('\n')
      .trim()
      .slice(-1800);
    throw new Error(`netlify ${argv.join(' ')} failed.\n${detail || e.message}`);
  }
}

/** The literal `env` values a Vite build bakes in: only VITE_* names (public
 *  by Vite's rules), never passthrough secrets. */
function buildEnv(cfg) {
  const out = {};
  if (cfg.env && typeof cfg.env === 'object') {
    for (const [k, v] of Object.entries(cfg.env)) {
      if (k.startsWith('VITE_') && v !== null && v !== undefined && String(v).length > 0) out[k] = String(v);
    }
  }
  return out;
}

/** Run the configured build command inside the app directory. Netlify uploads
 *  this prebuilt directory, so VITE_* values from target.yml `env` must be in
 *  the build's environment, not only on the Netlify site. */
function runBuild(cfg, appDir) {
  const extra = buildEnv(cfg);
  log(`Building in ${appDir}: ${cfg.build}${Object.keys(extra).length ? ` (with ${Object.keys(extra).join(', ')})` : ''}`);
  execSync(cfg.build, { cwd: appDir, stdio: 'inherit', env: { ...process.env, ...extra } });
}

async function deployNetlify(cfg) {
  const n = cfg.netlify ?? {};
  const appDir = path.resolve(process.cwd(), cfg.directory);
  const publishDir = path.resolve(appDir, cfg.publish ?? 'client/dist');
  // functionsDir: '' in target.yml means "static site, no functions". Resolving
  // '' would yield appDir itself, making the CLI bundle the whole project as
  // functions, so keep it empty and skip everything functions-related below.
  const functionsDir =
    n.functionsDir === '' ? '' : path.resolve(appDir, n.functionsDir ?? 'netlify/functions');
  const env = collectEnv(cfg);

  const plan = {
    action: 'build, create-if-missing, set env, deploy --prod',
    name: cfg.projectName,
    siteName: n.siteName || cfg.projectName,
    siteId: n.siteId || process.env.NETLIFY_SITE_ID || '(resolve by name)',
    build: cfg.build,
    publishDir,
    functionsDir,
    accountSlug: n.accountSlug || '(default team)',
    envVarsForwarded: Object.keys(env),
    envVarsRemoved: cfg.envRemove,
    siteFooter: cfg.footer !== false,
    customDomain: appDomainFor(n.customDomain) || '(none)',
    ...(n.customDomain && appDomainFor(n.customDomain) !== n.customDomain ? { customDomainInTargetYml: n.customDomain } : {}),
  };
  log('Netlify plan:\n' + JSON.stringify(plan, null, 2));

  if (DRY_RUN) {
    log('dry-run: no build and no Netlify CLI calls made.');
    return;
  }
  if (!process.env.NETLIFY_AUTH_TOKEN) fail('NETLIFY_AUTH_TOKEN is not set in the environment.');

  // Netlify site subdomains are GLOBALLY unique, so the site name often needs
  // to differ from the (Render) projectName. Prefer an explicit id when given.
  // `let`: Netlify may give the site a different name than the one asked for
  // (a taken name gets a numeric suffix, e.g. popup-check-629), and the
  // redirect rule and DNS target must use the real one.
  let siteName = n.siteName || cfg.projectName;

  try {
    log('Netlify CLI version:', netlify(['--version'], { capture: true }).trim());
  } catch {
    /* non-fatal diagnostic */
  }

  // Netlify uploads a prebuilt directory, so build locally first.
  runBuild(cfg, appDir);
  // The shared "built by" footer (scripts/site-footer.mjs). `footer: false`
  // in target.yml opts an app out.
  if (cfg.footer !== false) {
    const added = injectFooterIntoDir(publishDir, cfg.projectName);
    log(added ? 'Added the site footer to index.html.' : 'Site footer already present.');
  }

  // Resolve the site id, in order of reliability:
  //   1. netlify.siteId in target.yml   2. NETLIFY_SITE_ID env
  //   3. lookup an existing site by name 4. create a new site by name
  let siteId = n.siteId || process.env.NETLIFY_SITE_ID || '';
  if (siteId) log(`Using configured Netlify site id ${siteId}`);

  if (!siteId) {
    try {
      const sitesJson = netlify(['api', 'listSites', '--data', '{}'], { capture: true });
      const sites = JSON.parse(sitesJson || '[]');
      // Match by name, or by the custom domain: a site Netlify created under a
      // suffixed name is still found on later deploys instead of duplicated.
      const found =
        sites.find((s) => s.name === siteName) ||
        (n.customDomain
          ? sites.find((s) => [appDomainFor(n.customDomain), n.customDomain].includes(s.custom_domain))
          : undefined);
      siteId = found?.id ?? '';
      if (found && found.name && found.name !== siteName) {
        ghNotice(`warning: ${cfg.projectName}: Netlify site is named "${found.name}", not "${siteName}"; set netlify.siteName: ${found.name} in target.yml.`);
        siteName = found.name;
      }
      if (siteId) log(`Found existing site "${siteName}" (${siteId}).`);
    } catch (e) {
      log('Could not list sites (will try to create):', String(e).slice(0, 160));
    }
  }

  if (!siteId) {
    log(`Creating Netlify site "${siteName}".`);
    const createArgs = ['sites:create', '--name', siteName, '--json'];
    if (n.accountSlug) createArgs.push('--account-slug', n.accountSlug);
    let created = '';
    try {
      created = netlify(createArgs, { capture: true });
    } catch (e) {
      fail(
        `Creating site "${siteName}" failed. The name may be taken globally on Netlify, ` +
          `or your token may have multiple teams. Fix options: set netlify.siteName to a ` +
          `unique value, set netlify.accountSlug, or create the site once and set ` +
          `netlify.siteId in target.yml. Underlying error: ${String(e).slice(0, 200)}`,
      );
    }
    // sites:create --json prints the created site as JSON; fall back to text.
    try {
      const obj = JSON.parse(created);
      siteId = obj.site_id || obj.id || '';
      if (obj.name && obj.name !== siteName) {
        ghNotice(`warning: ${cfg.projectName}: Netlify created the site as "${obj.name}" (the name "${siteName}" was taken); set netlify.siteName: ${obj.name} in target.yml.`);
        siteName = obj.name;
      }
    } catch {
      siteId = created.match(/Site ID:\s*([a-f0-9-]+)/i)?.[1] ?? '';
    }
    if (!siteId) fail('Created the site but could not determine its Site ID.');
    log(`Created site ${siteId}.`);
  }

  // A custom domain is used only once its DNS record exists (created here when
  // CLOUDFLARE_API_TOKEN is set): the redirect rule below would otherwise send
  // the working .netlify.app address to a name that does not resolve.
  // target.yml's <app>.pisan.me becomes <app>.hintwise.org (scripts/domains.mjs).
  let customDomain = appDomainFor(n.customDomain);
  if (customDomain) {
    try {
      const dns = await ensureDomainDns({ domain: customDomain, target: `${siteName}.netlify.app` });
      if (dns.warning || !dns.ready) ghNotice(`warning: ${cfg.projectName}: ${dns.message}`);
      else log(dns.message);
      if (!dns.ready) customDomain = '';
    } catch (e) {
      // A DNS or Cloudflare API failure keeps the domain only if public DNS
      // already answers for it. (Before the move to hintwise.org every app
      // had its record, so the domain was always kept; a hintwise name may
      // not exist yet, and a redirect to it would break the site.)
      const ok = await resolves(customDomain).catch(() => false);
      ghNotice(
        `warning: ${cfg.projectName}: DNS check failed (${String(e).slice(0, 200)}); ` +
          (ok ? `${customDomain} resolves, using it.` : `${customDomain} does not resolve, so no custom domain this deploy.`),
      );
      if (!ok) customDomain = '';
    }
  }

  // The Netlify CLI refuses to run inside an npm workspaces root ("Projects
  // detected: @accessibility-lens/server, ..."). Run all site-scoped commands
  // from a clean staging directory with no package.json and a self-contained
  // netlify.toml. The prebuilt --dir/--functions are absolute, and the
  // function's imports resolve from its own location, so nothing depends on the
  // staging dir's contents besides the config.
  const stageDir = path.join(os.tmpdir(), 'al-netlify-stage');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(
    path.join(stageDir, 'netlify.toml'),
    functionsDir
      ? '[functions]\n  node_bundler = "esbuild"\n  external_node_modules = ["jsdom"]\n'
      : '# static site: no functions\n',
  );
  // Redirects via a _redirects file in the publish dir: most reliable for
  // prebuilt deploys (API to the function first when one exists, then SPA
  // fallback).
  writeFileSync(
    path.join(publishDir, '_redirects'),
    (functionsDir ? '/api/*  /.netlify/functions/api/:splat  200\n' : '') +
      '/*      /index.html                     200\n',
  );
  // With a custom domain, send the old .netlify.app address there for good, so
  // links and search engines end up on one URL. Netlify serves the default
  // subdomain alongside the primary domain unless a rule says otherwise. The
  // rule goes first in _redirects because the first matching rule wins.
  if (customDomain) {
    const file = path.join(publishDir, '_redirects');
    const rule = `https://${siteName}.netlify.app/* https://${customDomain}/:splat 301!`;
    // Runs after the SPA fallback above is written, which replaces the file.
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!existing.includes(rule)) writeFileSync(file, `${rule}\n${existing}`);
    log(`Redirect rule: ${rule}`);
  }
  const run = { cwd: stageDir };

  // Forward environment variables to the site (for the serverless function).
  // Explicit --scope/--context: Netlify's defaults can omit the functions
  // runtime, which silently leaves the function without the variable.
  // Best-effort (the app degrades gracefully), but report the outcome loudly so
  // a failure is visible instead of mysterious.
  // envRemove: variables to delete from the site. Dropping a name from
  // envPassthrough only stops sending it; Netlify keeps the last value, so a
  // secret has to be removed explicitly. Unlike setting, failure here stops
  // the deploy: shipping with a key that was meant to be gone is worse.
  for (const key of cfg.envRemove) {
    log(`Removing Netlify env ${key}`);
    netlify(['env:unset', key, '--site', siteId], run);
  }
  for (const [key, value] of Object.entries(env)) {
    try {
      log(`Setting Netlify env ${key}`);
      netlify(
        ['env:set', key, value, '--site', siteId, '--scope', 'functions,builds,runtime', '--context', 'production'],
        run,
      );
    } catch (e) {
      // Older CLI versions reject the flags; retry without them before warning.
      try {
        netlify(['env:set', key, value, '--site', siteId], run);
      } catch (e2) {
        ghNotice(`warning: could not set env ${key} on ${cfg.projectName}: ${String(e2).slice(0, 200)}`);
      }
    }
  }

  // Deploy to production with absolute paths and the explicit site id.
  // --json gives us the live URL to report back.
  const out = netlify(
    [
      'deploy',
      '--prod',
      '--json',
      '--site',
      siteId,
      '--dir',
      publishDir,
      ...(functionsDir ? ['--functions', functionsDir] : []),
    ],
    { ...run, capture: true },
  );
  log('Netlify production deploy complete.');
  let url = `https://${siteName}.netlify.app`;
  try {
    const info = JSON.parse(out);
    url = info.ssl_url || info.url || info.deploy_ssl_url || info.deploy_url || url;
  } catch {
    /* fall back to the conventional site URL */
  }
  // netlify.customDomain, mapped to hintwise.org (e.g. bombe-bench.hintwise.org),
  // becomes the site's primary domain, so Netlify redirects the .netlify.app address to it. The
  // DNS CNAME must point at <siteName>.netlify.app (DNS only, not
  // proxied), or Netlify cannot issue the certificate.
  if (customDomain) {
    await ensureCustomDomain(siteId, customDomain);
    url = `https://${customDomain}`;
  }
  ghNotice(`${cfg.projectName} (netlify): ${url}`);

  // Verify the live site actually works (the CI runner can reach it, unlike a
  // local sandbox). Sites with functions get the /api/health JSON check; a
  // static site has no API, so the page itself coming back is the health check.
  // A new custom domain may wait a minute or two for its certificate.
  const attempts = customDomain ? 30 : 4;
  if (functionsDir) await verifyHealth(url, cfg.projectName, attempts);
  else await verifyPage(url, cfg.projectName, attempts);
}

/** Call the Netlify REST API with the deploy token; returns parsed JSON. */
async function netlifyApi(route, init = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,
      'content-type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Netlify API ${init.method || 'GET'} ${route} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Make `domain` the site's primary custom domain and ask for its certificate.
 * The app's old pisan.me name is not kept as an alias once Cloudflare answers
 * it (proxied record + redirect rule); while its record is still DNS only it
 * stays an alias, so the old address keeps working until the switch.
 */
async function ensureCustomDomain(siteId, domain) {
  const site = await netlifyApi(`/sites/${siteId}`);
  const oldDomain = oldDomainFor(domain);
  const aliases = (site.domain_aliases || []).filter((d) => d !== domain);
  let wanted = aliases;
  if (oldDomain !== domain) {
    const onSite = site.custom_domain === oldDomain || aliases.includes(oldDomain);
    const { keep, reason } = onSite ? await keepOldAlias({ oldDomain }) : { keep: false };
    wanted = aliases.filter((d) => d !== oldDomain);
    if (onSite && keep) wanted.push(oldDomain);
    if (onSite) log(`${oldDomain} ${keep ? 'stays a domain alias' : 'is dropped from the site'}: ${reason}.`);
  }
  const current = site.domain_aliases || [];
  const sameAliases = wanted.length === current.length && wanted.every((d) => current.includes(d));
  if (site.custom_domain === domain && sameAliases) {
    log(`Custom domain already ${domain}.`);
  } else {
    log(`Setting custom domain ${domain} (was ${site.custom_domain || 'none'}); aliases: ${wanted.join(', ') || 'none'}.`);
    await netlifyApi(`/sites/${siteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ custom_domain: domain, domain_aliases: wanted }),
    });
  }
  // Netlify provisions the Let's Encrypt certificate on its own once DNS
  // resolves; asking now saves waiting for its next check. A failure here is
  // usually "DNS not verified yet", so it is logged, not fatal.
  try {
    await netlifyApi(`/sites/${siteId}/ssl`, { method: 'POST' });
    log(`Requested a TLS certificate for ${domain}.`);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('existing certificate')) {
      // Renew so an added domain joins the certificate (the dashboard's Renew button).
      try {
        await netlifyApi(`/sites/${siteId}/ssl/renew`, { method: 'POST' });
        log(`Asked Netlify to renew the certificate so it covers ${domain}.`);
      } catch (e2) {
        log(`Certificate renewal did not go through: ${String(e2).slice(0, 300)}`);
      }
    }
    else log(`TLS certificate request did not go through yet: ${msg.slice(0, 300)}`);
  }
}

/** Fetch the site root and report the result as an annotation (static sites). */
async function verifyPage(url, projectName, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'text/html' } });
      const body = (await res.text()).slice(0, 200);
      if (res.ok && /<[a-z!]/i.test(body)) {
        ghNotice(`${projectName} page OK: ${url} -> ${res.status}`);
        return;
      }
      if (attempt === attempts) {
        ghError(
          `${projectName} deployed but ${url} returned HTTP ${res.status}. Body started: ${body}`,
        );
        return;
      }
    } catch (e) {
      if (attempt === attempts) {
        ghError(`${projectName} page check could not reach ${url}: ${String(e).slice(0, 160)}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, attempts > 4 ? 10000 : 3000));
  }
}

/** Fetch <url>/api/health and report the result as an annotation. */
async function verifyHealth(url, projectName, attempts = 4) {
  const target = `${url.replace(/\/$/, '')}/api/health`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(target, { headers: { accept: 'application/json' } });
      const body = (await res.text()).slice(0, 200);
      const ok = res.ok && body.includes('"status"');
      if (ok) {
        ghNotice(`${projectName} health OK: ${target} -> ${res.status} ${body}`);
        return;
      }
      if (attempt === attempts) {
        ghError(
          `${projectName} deployed but /api/health did not return JSON ` +
            `(HTTP ${res.status}). The serverless function or its routing is not working. ` +
            `Body started: ${body}`,
        );
        return;
      }
    } catch (e) {
      if (attempt === attempts) {
        ghError(`${projectName} health check could not reach ${target}: ${String(e).slice(0, 160)}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, attempts > 4 ? 10000 : 3000));
  }
}

// --------------------------------------------------------------------------

async function main() {
  const cfg = loadConfig();
  log(`Provider: ${cfg.provider} | Project: ${cfg.projectName} | Dry run: ${DRY_RUN}`);
  if (cfg.provider === 'render') await deployRender(cfg);
  else await deployNetlify(cfg);
  log('Done.');
}

main().catch((err) => fail(err?.stack || String(err)));
