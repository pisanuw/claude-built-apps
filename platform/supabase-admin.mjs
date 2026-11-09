#!/usr/bin/env node
/**
 * Supabase admin for the shared HintWise project (docs/platform.md).
 * Runs from the "Supabase admin" GitHub Actions workflow with the repo
 * secrets; nothing here ever prints a secret value.
 *
 *   inspect                 project, region, exposed schemas, auth settings
 *                           (booleans and hosts only), schemas, tables with
 *                           row estimates, extensions, edge functions, the
 *                           names of function secrets
 *   sql <file.sql>          run one SQL file through the Management API
 *   apply-shared            run platform/supabase/shared/*.sql in name order,
 *                           skipping files already recorded with the same
 *                           sha256 in platform.migrations (app "platform")
 *   migrate <slug>          run <slug>/supabase/migrations/*.sql the same way
 *                           (app = slug); refuses if a recorded file changed
 *   expose-schema <schema>  add a schema to PostgREST's db_schema list
 *   configure-auth [--google] [--dry-run]
 *                           additive auth settings: hintwise.org redirect
 *                           allow-list, Resend SMTP (RESEND_API), email
 *                           rate limit; --google also switches the Google
 *                           client to HINTWISE_AUTH_GOOGLE_ID / _SECRET
 *   keys [--write]          print the project URL and anon (publishable) key
 *                           as the JSON for platform/supabase.json
 *   usage [days]            print platform.llm_usage_report(days) as tables
 *
 * The gateway itself is deployed by shell steps of the same workflow
 * (deploy-gateway, set-gateway-key), not by this script.
 *
 * Env: SUPABASE_ACCESS_TOKEN (personal access token), and SUPABASE_URL
 * (https://<ref>.supabase.co) or SUPABASE_PROJECT_REF. configure-auth also
 * reads RESEND_API and, with --google, HINTWISE_AUTH_GOOGLE_ID and
 * HINTWISE_AUTH_GOOGLE_SECRET.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const API = 'https://api.supabase.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || '';
const ref = process.env.SUPABASE_PROJECT_REF || url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [cmd, arg] = argv.filter((a) => !a.startsWith('--'));

function fail(msg) { console.log(`::error::${msg}`); process.exit(1); }

async function api(route, init = {}) {
  const res = await fetch(`${API}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Runs SQL through the Management API; a select returns its rows as an array.
// Other statements return something else (shape unconfirmed): treat anything
// that is not an HTTP error as success.
async function sql(query) {
  return api(`/v1/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query }) });
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Keys whose values are secrets or long tokens: never print them.
const SECRET_KEY = /(pass|secret|key|token|password|private)/i;
function safe(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (SECRET_KEY.test(k)) out[k] = v === null || v === undefined || v === '' ? '(unset)' : '(set)';
    else out[k] = v;
  }
  return out;
}

function table(rows) {
  if (!rows?.length) return console.log('  (none)');
  const keys = Object.keys(rows[0]);
  console.log('  ' + keys.join(' | '));
  for (const r of rows) console.log('  ' + keys.map((k) => String(r[k] ?? '')).join(' | '));
}

async function inspect() {
  const p = await api(`/v1/projects/${ref}`);
  console.log(`Project ${p.name} (${ref}): region ${p.region}, status ${p.status}, created ${p.created_at}`);
  console.log(`Database host: ${p.database?.host || '?'} (version ${p.database?.version || '?'})`);

  console.log('\nPostgREST (exposed schemas):');
  // The config carries jwt_secret: print only the non-secret settings.
  try {
    const pg = await api(`/v1/projects/${ref}/postgrest`);
    console.log(`  db_schema: ${pg.db_schema}; db_extra_search_path: ${pg.db_extra_search_path}; max_rows: ${pg.max_rows}`);
  } catch (e) { console.log('  cannot read:', String(e).slice(0, 200)); }

  console.log('\nAuth settings (values hidden for secret-like keys):');
  try {
    const a = await api(`/v1/projects/${ref}/config/auth`);
    const keep = /^(site_url|uri_allow_list|disable_signup|external_email_enabled|external_anonymous_users_enabled|mailer_autoconfirm|mailer_otp_exp|mailer_otp_length|smtp_host|smtp_port|smtp_user|smtp_sender_name|smtp_admin_email|smtp_max_frequency|rate_limit_email_sent|external_google_enabled|external_google_client_id|external_google_skip_nonce_check|password_min_length|jwt_exp|refresh_token_rotation_enabled|security_captcha_enabled|mfa_totp_enroll_enabled|external_github_enabled|external_apple_enabled|external_azure_enabled)$/;
    const shown = Object.fromEntries(Object.entries(safe(a)).filter(([k]) => keep.test(k)));
    for (const [k, v] of Object.entries(shown)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    const providers = Object.entries(a).filter(([k, v]) => /^external_.*_enabled$/.test(k) && v === true).map(([k]) => k.replace(/^external_|_enabled$/g, ''));
    console.log(`  enabled providers: ${providers.join(', ') || '(none)'}`);
  } catch (e) { console.log('  cannot read:', String(e).slice(0, 200)); }

  console.log('\nSchemas (non-system):');
  table(await sql(`select nspname as schema, pg_get_userbyid(nspowner) as owner
    from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast')
    and nspname not like 'pg_temp%' and nspname not like 'pg_toast%' order by 1`));

  console.log('\nTables (row estimates):');
  table(await sql(`select n.nspname as schema, c.relname as "table", c.reltuples::bigint as est_rows,
      pg_size_pretty(pg_total_relation_size(c.oid)) as size, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast','extensions','realtime','vault','supabase_functions','graphql','graphql_public','pgsodium','pgsodium_masks','net','cron','supabase_migrations')
    order by 1,2`));

  console.log('\nAuth users:');
  table(await sql(`select count(*)::int as users, count(*) filter (where last_sign_in_at > now() - interval '30 days')::int as active_30d,
    min(created_at)::date as first, max(created_at)::date as last from auth.users`));

  console.log('\nStorage buckets:');
  try { table(await sql(`select id, public, created_at::date as created from storage.buckets order by 1`)); }
  catch (e) { console.log('  cannot read:', String(e).slice(0, 120)); }

  console.log('\nExtensions:');
  table(await sql(`select extname as name, extversion as version from pg_extension order by 1`));

  console.log('\nCron jobs (pg_cron):');
  try { table(await sql(`select jobid, jobname, schedule, active from cron.job order by 1`)); }
  catch { console.log('  pg_cron not installed'); }

  console.log('\nEdge functions:');
  try { table((await api(`/v1/projects/${ref}/functions`)).map((f) => ({ slug: f.slug, status: f.status, version: f.version, updated: f.updated_at }))); }
  catch (e) { console.log('  cannot read:', String(e).slice(0, 200)); }

  console.log('\nFunction secret names:');
  try { table((await api(`/v1/projects/${ref}/secrets`)).map((s) => ({ name: s.name }))); }
  catch (e) { console.log('  cannot read:', String(e).slice(0, 200)); }

  console.log('\nPlatform migrations recorded:');
  try { table(await sql(`select app, file, left(sha256, 12) as sha256, applied_at from platform.migrations order by app, file`)); }
  catch { console.log('  platform.migrations does not exist yet (run apply-shared)'); }
}

async function runFile(file) {
  if (!file || !fs.existsSync(file)) fail(`sql: file not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  console.log(`Running ${file} (${text.length} chars)`);
  const rows = await sql(text);
  console.log(`Done. ${Array.isArray(rows) ? rows.length : 0} row(s) returned.`);
  if (Array.isArray(rows) && rows.length) table(rows.slice(0, 50));
}

// ---- migrations -----------------------------------------------------------

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Recorded files for one app. On the very first run the table does not exist
// yet (the shared SQL creates it), which reads as an empty record.
async function recorded(app) {
  try {
    const rows = await sql(`select file, sha256 from platform.migrations where app = ${lit(app)}`);
    return new Map((Array.isArray(rows) ? rows : []).map((r) => [r.file, r.sha256]));
  } catch (e) {
    if (/does not exist/i.test(String(e.message))) return new Map();
    throw e;
  }
}

async function record(app, file, hash) {
  await sql(`insert into platform.migrations (app, file, sha256) values (${lit(app)}, ${lit(file)}, ${lit(hash)})
    on conflict (app, file) do update set sha256 = excluded.sha256, applied_at = now()`);
}

/**
 * Applies every .sql file of a directory in name order, recording each in
 * platform.migrations. `onChanged` says what to do with a file whose recorded
 * hash differs from its content: 'rerun' (shared SQL is idempotent by
 * contract) or 'refuse' (an app migration that ran must not be edited).
 */
async function applyDir(app, dir, onChanged) {
  if (!fs.existsSync(dir)) fail(`${app}: no directory ${path.relative(ROOT, dir)}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) { console.log(`${app}: no .sql files in ${path.relative(ROOT, dir)}`); return; }
  const done = await recorded(app);
  let applied = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const hash = sha256(text);
    const had = done.get(file);
    if (had === hash) { console.log(`  skip ${file} (already applied, ${hash.slice(0, 12)})`); continue; }
    if (had && onChanged === 'refuse') {
      fail(`${app}: ${file} was applied with sha256 ${had.slice(0, 12)} but now hashes ${hash.slice(0, 12)}. A migration that has run must not change: add a new numbered file instead.`);
    }
    console.log(`  ${had ? 'rerun' : 'apply'} ${file} (${text.length} chars, ${hash.slice(0, 12)})`);
    await sql(text);
    await record(app, file, hash);
    applied += 1;
  }
  console.log(`${app}: ${applied} file(s) applied, ${files.length - applied} skipped.`);
}

async function applyShared() {
  await applyDir('platform', path.join(ROOT, 'platform', 'supabase', 'shared'), 'rerun');
}

async function migrate(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail('migrate: give an app slug, e.g. migrate donation-receipts');
  await applyDir(slug, path.join(ROOT, slug, 'supabase', 'migrations'), 'refuse');
}

// ---- PostgREST ------------------------------------------------------------

async function exposeSchema(schema) {
  if (!schema || !/^[a-z_][a-z0-9_]*$/.test(schema)) fail('expose-schema: give a schema name, e.g. expose-schema app_my_app');
  const pg = await api(`/v1/projects/${ref}/postgrest`);
  const before = String(pg.db_schema || '');
  const list = before.split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`db_schema before: ${before}`);
  if (list.includes(schema)) { console.log(`${schema} is already exposed; nothing to do.`); return; }
  const after = [...list, schema].join(',');
  // PATCH only this one field; the config also carries jwt_secret, never sent back or printed.
  await api(`/v1/projects/${ref}/postgrest`, { method: 'PATCH', body: JSON.stringify({ db_schema: after }) });
  const check = await api(`/v1/projects/${ref}/postgrest`);
  console.log(`db_schema after:  ${check.db_schema}`);
}

// ---- Auth -----------------------------------------------------------------

const HINTWISE_REDIRECT = 'https://*.hintwise.org/**';

/** Pure: the additive PATCH for config/auth given the current config. */
export function authPatch(current, env, { google = false } = {}) {
  const patch = {};
  const want = (k, v) => { if (current[k] !== v) patch[k] = v; };

  const allow = String(current.uri_allow_list || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allow.includes(HINTWISE_REDIRECT)) patch.uri_allow_list = [...allow, HINTWISE_REDIRECT].join(',');

  want('external_email_enabled', true);
  want('smtp_host', 'smtp.resend.com');
  want('smtp_port', '465');
  want('smtp_user', 'resend');
  if (env.RESEND_API) want('smtp_pass', env.RESEND_API);
  want('smtp_admin_email', 'sign-in@hintwise.org');
  want('smtp_sender_name', 'HintWise');
  const rate = Number(current.rate_limit_email_sent);
  if (!Number.isFinite(rate) || rate < 30) patch.rate_limit_email_sent = 30; // only ever raised

  if (google) {
    want('external_google_enabled', true);
    if (env.HINTWISE_AUTH_GOOGLE_ID) want('external_google_client_id', env.HINTWISE_AUTH_GOOGLE_ID);
    if (env.HINTWISE_AUTH_GOOGLE_SECRET) want('external_google_secret', env.HINTWISE_AUTH_GOOGLE_SECRET);
  }
  return patch;
}

async function configureAuth() {
  const google = flags.has('--google');
  const dryRun = flags.has('--dry-run');
  if (!process.env.RESEND_API) console.log('::warning::RESEND_API is not set; smtp_pass will not be changed');
  if (google && !(process.env.HINTWISE_AUTH_GOOGLE_ID && process.env.HINTWISE_AUTH_GOOGLE_SECRET)) {
    fail('--google needs HINTWISE_AUTH_GOOGLE_ID and HINTWISE_AUTH_GOOGLE_SECRET');
  }
  const current = await api(`/v1/projects/${ref}/config/auth`);
  const patch = authPatch(current, process.env, { google });
  const keys = Object.keys(patch);
  if (!keys.length) { console.log('Auth config already as wanted; nothing to change.'); return; }
  console.log(`${dryRun ? 'Would change' : 'Changing'} ${keys.length} key(s):`);
  for (const k of keys) {
    if (SECRET_KEY.test(k)) console.log(`  ${k}: ${current[k] ? '(set)' : '(unset)'} -> (set)`);
    else console.log(`  ${k}: ${JSON.stringify(current[k] ?? null)} -> ${JSON.stringify(patch[k])}`);
  }
  if (dryRun) { console.log('Dry run: nothing sent.'); return; }
  await api(`/v1/projects/${ref}/config/auth`, { method: 'PATCH', body: JSON.stringify(patch) });
  const after = await api(`/v1/projects/${ref}/config/auth`);
  const shown = Object.fromEntries(Object.entries(safe(after)).filter(([k]) => keys.includes(k)));
  console.log('After:', JSON.stringify(shown));
}

// ---- Keys -----------------------------------------------------------------

/** Pure: picks the public anon/publishable key out of the api-keys listing. */
export function pickAnonKey(keys) {
  const list = Array.isArray(keys) ? keys : [];
  const hit = list.find((k) => k?.name === 'anon' || k?.type === 'publishable' || k?.name === 'publishable'
    || (typeof k?.api_key === 'string' && k.api_key.startsWith('sb_publishable_')));
  return hit && typeof hit.api_key === 'string' ? hit.api_key : null;
}

async function keys() {
  const list = await api(`/v1/projects/${ref}/api-keys`);
  const anon = pickAnonKey(list);
  if (!anon) {
    console.log('Could not find an anon or publishable key with an api_key field. Key names:');
    table((Array.isArray(list) ? list : []).map((k) => ({ name: k?.name, type: k?.type ?? '' })));
    fail('keys: endpoint shape differs from the expected [{name, api_key}] list');
  }
  // The anon key is public by design (it is shipped in every app's bundle);
  // the service_role key in the same listing is never printed.
  const out = { url: url || `https://${ref}.supabase.co`, anonKey: anon };
  const json = JSON.stringify(out, null, 2) + '\n';
  console.log('platform/supabase.json:');
  console.log(json);
  if (flags.has('--write')) {
    fs.writeFileSync(path.join(ROOT, 'platform', 'supabase.json'), json);
    console.log('Written to platform/supabase.json (commit it).');
  }
}

// ---- Usage ----------------------------------------------------------------

async function usage(daysArg) {
  const days = Math.max(1, Number(daysArg) || 1);
  const rows = await sql(`select platform.llm_usage_report(${days})::text as report`);
  const raw = Array.isArray(rows) ? rows[0]?.report : null;
  if (!raw) fail('usage: platform.llm_usage_report returned nothing (run apply-shared first)');
  const report = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // Same renderer as the daily email (platform/llm-usage-report.mjs).
  const { renderText } = await import('./src/report/format.mjs');
  console.log(renderText(report, new Date()));
}

// ---- main -----------------------------------------------------------------

const commands = {
  inspect: () => inspect(),
  sql: () => runFile(arg),
  'apply-shared': () => applyShared(),
  migrate: () => migrate(arg),
  'expose-schema': () => exposeSchema(arg),
  'configure-auth': () => configureAuth(),
  keys: () => keys(),
  usage: () => usage(arg),
};

// SUPABASE_ADMIN_NO_RUN=1 lets tests import the pure helpers without running.
if (process.env.SUPABASE_ADMIN_NO_RUN !== '1') {
  if (!token) fail('SUPABASE_ACCESS_TOKEN is not set');
  if (!ref) fail('SUPABASE_PROJECT_REF or SUPABASE_URL (https://<ref>.supabase.co) is not set');
  try {
    if (!commands[cmd]) fail(`unknown command ${cmd}; use one of ${Object.keys(commands).join(', ')}`);
    await commands[cmd]();
  } catch (e) {
    fail(String(e.message || e).slice(0, 500));
  }
}
