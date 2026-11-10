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
 *   expose-schema <schema> [--reapply]
 *                           add a schema to PostgREST's db_schema list;
 *                           --reapply sends the list again when it is stored
 *                           but the API does not serve it yet
 *   check-schema <schema>   security check of an app schema, read-only:
 *                           RLS on every table, no anon table access,
 *                           security definer functions pin search_path, a
 *                           signed-in stranger sees no row of real data, and
 *                           Supabase's security advisor; exits 1 on a finding
 *   configure-auth [--google] [--email-rate=N] [--dry-run]
 *                           additive auth settings: hintwise.org redirect
 *                           allow-list, Resend SMTP (RESEND_API), email
 *                           rate limit; --google also switches the Google
 *                           client to HINTWISE_AUTH_GOOGLE_ID / _SECRET
 *   keys [--write]          print the project URL and anon (publishable) key
 *                           as the JSON for platform/supabase.json
 *   usage [days]            print platform.llm_usage_report(days) as tables
 *   domain-setup <host>     custom domain add-on (owner buys it first): start
 *                           <host> (e.g. auth.hintwise.org) on the project,
 *                           create its CNAME and TXT records in Cloudflare
 *                           (DNS only; existing records are never changed)
 *                           and ask Supabase to verify them
 *   domain-status           where the custom domain stands; re-verifies while
 *                           it is waiting, and lists any record still missing
 *   domain-activate --callbacks-ready
 *                           switch Auth to the custom domain. Only after every
 *                           OAuth client lists https://<host>/auth/v1/callback:
 *                           from then on Google is sent that callback
 *   check-google [returnTo] [--base=URL]
 *                           start a Google sign-in the way a browser would
 *                           and report what Supabase and Google answer: the
 *                           Google client in use, the callback URL, whether
 *                           Google accepts them (redirect_uri_mismatch shows
 *                           up here), and where Supabase would send the user
 *                           back. No login, no secret. --base is the auth host
 *                           to test (default SUPABASE_URL; later the custom
 *                           domain). Exits 1 when the flow is broken.
 *   email-hook status|check|on|off [--dry-run] [--allow-otp-apps]
 *                           Supabase Auth's Send Email hook (auth-email-hook):
 *                           status prints it; check exits 1 unless the function
 *                           is deployed, its secrets are set and no app in this
 *                           repo still calls signInWithOtp; on points the
 *                           hook at the function with SEND_EMAIL_HOOK_SECRET
 *                           from the env (the workflow generates it and sets
 *                           the same value as the function secret first); off
 *                           switches it off. Owner's yes before on.
 *
 * Edge functions are deployed, and their secrets set, by shell steps of the
 * same workflow (deploy-function, deploy-gateway, set-gateway-key,
 * set-sign-in-secrets), not by this script.
 *
 * Env: SUPABASE_ACCESS_TOKEN (personal access token), and SUPABASE_URL
 * (https://<ref>.supabase.co) or SUPABASE_PROJECT_REF. configure-auth also
 * reads RESEND_API and, with --google, HINTWISE_AUTH_GOOGLE_ID and
 * HINTWISE_AUTH_GOOGLE_SECRET. domain-setup also reads CLOUDFLARE_API_TOKEN
 * (and CLOUDFLARE_ZONE_ID as a fallback) for the DNS records. email-hook on
 * reads SEND_EMAIL_HOOK_SECRET.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cfApi, dnsRecords, showRecord, zoneIdFor } from '../accessibility-lens/deploy/cloudflare-dns.mjs';

const API = 'https://api.supabase.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || '';
const ref = process.env.SUPABASE_PROJECT_REF || url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
/** The value of a --name=value flag, or undefined. */
const flagValue = (name) => [...flags].find((f) => f.startsWith(`${name}=`))?.slice(name.length + 1);
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
    const keep = /^(site_url|uri_allow_list|disable_signup|external_email_enabled|external_anonymous_users_enabled|mailer_autoconfirm|mailer_otp_exp|mailer_otp_length|smtp_host|smtp_port|smtp_user|smtp_sender_name|smtp_admin_email|smtp_max_frequency|rate_limit_email_sent|external_google_enabled|external_google_client_id|external_google_skip_nonce_check|password_min_length|jwt_exp|refresh_token_rotation_enabled|security_captcha_enabled|mfa_totp_enroll_enabled|external_github_enabled|external_apple_enabled|external_azure_enabled|hook_send_email_enabled|hook_send_email_uri)$/;
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
  // --reapply: the stored list already has the schema but the API still answers
  // PGRST106 (seen 10 Nov: PostgREST was not restarted after the PATCH), so
  // send the same list again to make Supabase reconfigure PostgREST.
  if (list.includes(schema) && !flags.has('--reapply')) { console.log(`${schema} is already exposed; nothing to do (add --reapply to send the list again).`); return; }
  const after = (list.includes(schema) ? list : [...list, schema]).join(',');
  // PATCH only this one field; the config also carries jwt_secret, never sent back or printed.
  await api(`/v1/projects/${ref}/postgrest`, { method: 'PATCH', body: JSON.stringify({ db_schema: after }) });
  const check = await api(`/v1/projects/${ref}/postgrest`);
  console.log(`db_schema after:  ${check.db_schema}`);
  await waitServed(schema, after);
}

/**
 * Waits until the Data API serves `schema` (any answer but PGRST106, "Invalid
 * schema"). On 10 Nov the stored list had the new schema but PostgREST kept
 * the old one for 25 minutes, until the same list was sent again; so after
 * 60 seconds the list is sent once more, then a warning is printed.
 */
async function waitServed(schema, list, { tries = 12, delayMs = 5000 } = {}) {
  let anonKey = '';
  try { anonKey = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'supabase.json'), 'utf8')).anonKey || ''; } catch { /* no public key file */ }
  if (!anonKey || !url) { console.log('Not checking the Data API (no platform/supabase.json anon key or SUPABASE_URL).'); return; }
  const served = async () => {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'accept-profile': schema } });
    const text = await res.text();
    return !text.includes('PGRST106');
  };
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < tries; i++) {
      if (await served()) { console.log(`The Data API serves ${schema}.`); return; }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if (round === 0) {
      console.log(`The Data API does not serve ${schema} yet; sending the list again.`);
      await api(`/v1/projects/${ref}/postgrest`, { method: 'PATCH', body: JSON.stringify({ db_schema: list }) });
    }
  }
  console.log(`::warning::The Data API still does not serve ${schema}; run Supabase admin expose-schema ${schema} --reapply later.`);
}

// ---- Schema security check -------------------------------------------------

/** SQL expression: the exact row count of table `<alias>.relname` in schema n, run as the current role. */
const ROWS = (alias) => `(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, ${alias}.relname), false, true, '')))[1]::text::int`;

/** Pure: SQL (run as postgres) describing every table and risky function of `schema`. */
export function schemaFactsSql(schema) {
  const s = lit(schema);
  return `select json_build_object(
  'tables', (select coalesce(json_agg(t order by t.name), '[]'::json) from (
    select c.relname as name, c.relrowsecurity as rls,
      (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname)::int as policies,
      (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) as anon_access,
      ${ROWS('c')} as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${s} and c.relkind in ('r', 'p')) t),
  'definers', (select coalesce(json_agg(p.proname order by p.proname), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = ${s} and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%'))
) as result;`;
}

/**
 * Pure: SQL that counts, per table of `schema`, the rows a signed-in user with
 * id `uid` (nobody's real id) can see. SET LOCAL keeps the role and claims to
 * this transaction, which the API ends; nothing is written.
 */
export function strangerSql(schema, uid) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
  return `begin;
set local role authenticated;
set local request.jwt.claims = ${lit(claims)};
set local request.jwt.claim.sub = ${lit(uid)};
select coalesce(json_object_agg(c.relname, ${ROWS('c')}), '{}'::json) as result
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${lit(schema)} and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'SELECT');`;
}

/** Pure: the first `result` value anywhere in a query response. */
export function queryResult(resp) {
  if (Array.isArray(resp)) {
    for (const item of resp) {
      const r = queryResult(item);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (resp && typeof resp === 'object' && 'result' in resp) {
    return typeof resp.result === 'string' ? JSON.parse(resp.result) : resp.result;
  }
  return undefined;
}

/**
 * Pure: findings from the facts, the stranger's view and the advisor lints.
 * Errors fail the check; notes say what could not be exercised.
 */
export function schemaFindings(schema, facts, visible, lints) {
  const errors = [];
  const warnings = [];
  const notes = [];
  for (const t of facts?.tables ?? []) {
    if (!t.rls) errors.push(`${schema}.${t.name}: row level security is off`);
    else if (!t.policies) warnings.push(`${schema}.${t.name}: RLS is on but has no policy, so the app cannot use it`);
    if (t.anon_access) errors.push(`${schema}.${t.name}: the anon role has table access (share rows through a security definer function instead)`);
    const seen = visible?.[t.name];
    if (typeof seen === 'number' && seen > 0) errors.push(`${schema}.${t.name}: a signed-in stranger sees ${seen} of ${t.rows} row(s)`);
    if (!t.rows) notes.push(`${schema}.${t.name}: no rows yet, so the stranger check had nothing to see`);
  }
  for (const fn of facts?.definers ?? []) errors.push(`${schema}.${fn}(): security definer without a fixed search_path`);
  for (const l of lints ?? []) {
    if (l?.metadata?.schema !== schema) continue;
    const line = `advisor ${l.level}: ${l.title || l.name}${l.metadata?.name ? ` (${l.metadata.name})` : ''}`;
    if (String(l.level).toUpperCase() === 'ERROR') errors.push(line);
    else warnings.push(line);
  }
  return { errors, warnings, notes };
}

async function checkSchema(schema) {
  if (!schema || !/^[a-z_][a-z0-9_]*$/.test(schema)) fail('check-schema: give a schema name, e.g. check-schema app_my_app');
  const facts = queryResult(await sql(schemaFactsSql(schema)));
  if (!facts?.tables?.length) { console.log(`${schema} has no tables; nothing to check.`); return; }
  console.log(`${schema}: ${facts.tables.map((t) => `${t.name} (${t.rows} row(s), RLS ${t.rls ? 'on' : 'OFF'}, ${t.policies} polic${t.policies === 1 ? 'y' : 'ies'})`).join('; ')}`);
  const visible = queryResult(await sql(strangerSql(schema, crypto.randomUUID())));
  console.log(`A signed-in stranger sees: ${JSON.stringify(visible ?? {})}`);
  let lints = [];
  try {
    const adv = await api(`/v1/projects/${ref}/advisors/security`);
    lints = Array.isArray(adv) ? adv : (adv?.lints ?? []);
  } catch (e) {
    console.log(`::warning::Security advisor not read: ${String(e.message || e).slice(0, 200)}`);
  }
  const { errors, warnings, notes } = schemaFindings(schema, facts, visible, lints);
  for (const n of notes) console.log(`note: ${n}`);
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) console.log(`::error::${e}`);
  if (errors.length) process.exit(1);
  console.log(`${schema}: security check passed.`);
}

// ---- Auth -----------------------------------------------------------------

const HINTWISE_REDIRECT = 'https://*.hintwise.org/**';

/**
 * Pure: the additive PATCH for config/auth given the current config.
 * @param {Record<string, unknown>} current
 * @param {Record<string, string | undefined>} env
 * @param {{ google?: boolean, emailRate?: number }} [opts]
 */
export function authPatch(current, env, { google = false, emailRate } = {}) {
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
  // Emails an hour for the whole project (every app shares it). Only ever
  // raised here: 30 by default, or --email-rate=N (owner, 10 Nov: 200).
  const rate = Number(current.rate_limit_email_sent);
  const wantRate = Math.max(30, Number.isInteger(emailRate) && emailRate > 0 ? emailRate : 30);
  if (!Number.isFinite(rate) || rate < wantRate) patch.rate_limit_email_sent = wantRate;

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
  const rateFlag = flagValue('--email-rate');
  const emailRate = rateFlag === undefined ? undefined : Number(rateFlag);
  if (rateFlag !== undefined && !(Number.isInteger(emailRate) && emailRate > 0 && emailRate <= 10000)) fail(`--email-rate wants a whole number of emails an hour, got ${rateFlag}`);
  const current = await api(`/v1/projects/${ref}/config/auth`);
  const patch = authPatch(current, process.env, { google, emailRate });
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

/** Pure: platform/supabase.json with url and anonKey first, keeping any other public value it already has. */
export function publicClientFile(existing, publicUrlValue, anonKey) {
  const rest = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const others = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'url' && k !== 'anonKey'));
  return { url: publicUrlValue, anonKey, ...others };
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
  // the service_role key in the same listing is never printed. Once the custom
  // domain is active, apps use it (docs/platform.md section 2, step 7).
  // Other public values already in the file (turnstileSiteKey) are kept.
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'supabase.json'), 'utf8')); } catch { /* no file yet */ }
  const out = publicClientFile(existing, publicUrl(await hostnameConfig(), url || `https://${ref}.supabase.co`), anon);
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

// ---- Custom domain (paid add-on) ------------------------------------------

/**
 * Pure: the DNS records Supabase wants for the custom hostname, from the GET
 * /custom-hostname response: the CNAME to the project, the ownership TXT and
 * the certificate TXT records (data.result.ownership_verification and
 * data.result.ssl.validation_records[].txt_name / txt_value).
 */
export function domainRecords(cfg, projectRef) {
  const host = String(cfg?.custom_hostname || '').toLowerCase();
  const result = cfg?.data?.result || {};
  const out = [];
  if (host) out.push({ type: 'CNAME', name: host, content: `${projectRef}.supabase.co` });
  const own = result.ownership_verification;
  if (own?.name && own?.value) out.push({ type: String(own.type || 'txt').toUpperCase(), name: String(own.name).toLowerCase(), content: String(own.value).trim() });
  for (const v of result.ssl?.validation_records || []) {
    if (v?.txt_name && v?.txt_value) out.push({ type: 'TXT', name: String(v.txt_name).toLowerCase(), content: String(v.txt_value).trim() });
  }
  return out;
}

/** Pure: one line on where the custom domain stands. */
export function domainSummary(cfg) {
  const r = cfg?.data?.result || {};
  const errs = [...(r.verification_errors || []), ...(r.ssl?.validation_errors || []).map((e) => e?.message || e)].filter(Boolean);
  return `${cfg?.custom_hostname || '(none)'}: ${cfg?.status || 'unknown'}; hostname ${r.status || '?'}, certificate ${r.ssl?.status || '?'}${errs.length ? `; errors: ${errs.join('; ')}` : ''}`;
}

const hostnameApi = (suffix = '', init) => api(`/v1/projects/${ref}/custom-hostname${suffix}`, init);

/** Pure: Supabase answers GET /custom-hostname with HTTP 400 before one is set up. */
export function isNoHostnameError(err) {
  return /HTTP 400\b/.test(String(err?.message || err)) && /no custom hostname configuration/i.test(String(err?.message || err));
}

/** Pure: the address apps should use: the custom domain once it is active, else the fallback. */
export function publicUrl(cfg, fallback) {
  const host = String(cfg?.custom_hostname || '').toLowerCase();
  return host && cfg?.status === '5_services_reconfigured' ? `https://${host}` : fallback;
}

/** The custom hostname configuration, or null when there is none yet. */
async function hostnameConfig() {
  try {
    return await hostnameApi();
  } catch (e) {
    if (isNoHostnameError(e)) return null;
    throw e;
  }
}

async function ensureRecords(records) {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!cfToken) { console.log('::warning::CLOUDFLARE_API_TOKEN is not set: create these records by hand:'); records.forEach((r) => console.log(`  ${showRecord(r)}`)); return; }
  for (const want of records) {
    const zoneId = await zoneIdFor({ domain: want.name, token: cfToken });
    const have = await dnsRecords({ zoneId, name: want.name, token: cfToken });
    const same = have.find((r) => r.type === want.type && String(r.content).replace(/^"|"$/g, '').replace(/\.$/, '') === want.content.replace(/\.$/, ''));
    if (same) { console.log(`  ok      ${showRecord(same)}`); continue; }
    if (want.type === 'CNAME' && have.length) {
      console.log(`  ::warning::${want.name} already has ${have.map(showRecord).join(', ')}; not changed. It must be CNAME -> ${want.content}.`);
      continue;
    }
    const made = await cfApi(fetch, cfToken, `/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: want.type, name: want.name, content: want.content, ttl: 60, proxied: false, comment: 'Supabase custom domain (platform/supabase-admin.mjs)' }),
    });
    console.log(`  created ${showRecord(made)}`);
  }
}

async function domainSetup(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) fail('domain-setup needs a hostname, e.g. auth.hintwise.org');
  let cfg = await hostnameConfig();
  if (cfg?.custom_hostname && cfg.custom_hostname !== h && cfg.status !== '1_not_started') {
    fail(`the project already has custom hostname ${cfg.custom_hostname} (${cfg.status}); remove it in the dashboard first`);
  }
  if (cfg?.custom_hostname !== h || cfg.status === '1_not_started') {
    await hostnameApi('/initialize', { method: 'POST', body: JSON.stringify({ custom_hostname: h }) });
    cfg = await hostnameApi();
  }
  console.log(domainSummary(cfg));
  const records = domainRecords(cfg, ref);
  console.log('DNS records:');
  await ensureRecords(records);
  try { await hostnameApi('/reverify', { method: 'POST' }); } catch (e) { console.log(`reverify: ${String(e.message).slice(0, 200)} (DNS can take a few minutes; run domain-status later)`); }
  console.log(domainSummary(await hostnameApi()));
  console.log(`Next: add https://${h}/auth/v1/callback to the Google client's Authorized redirect URIs (keep the supabase.co one), wait for status 4_origin_setup_completed (domain-status), then domain-activate --callbacks-ready.`);
}

async function domainStatus() {
  let cfg = await hostnameConfig();
  if (!cfg) { console.log('No custom hostname yet: run domain-setup <host>.'); return; }
  if (cfg?.status === '2_initiated' || cfg?.status === '3_challenge_verified') {
    try { await hostnameApi('/reverify', { method: 'POST' }); cfg = await hostnameApi(); } catch (e) { console.log(`reverify: ${String(e.message).slice(0, 200)}`); }
  }
  console.log(domainSummary(cfg));
  for (const r of domainRecords(cfg, ref)) console.log(`  needs ${showRecord({ ...r, proxied: false })}`);
}

async function domainActivate() {
  if (!flags.has('--callbacks-ready')) {
    fail('domain-activate switches Google sign-in to https://<host>/auth/v1/callback at once. Add that URI to every OAuth client of this project first, then re-run with --callbacks-ready.');
  }
  const cfg = await hostnameConfig();
  if (cfg?.status !== '4_origin_setup_completed') fail(`not ready to activate: ${domainSummary(cfg)}`);
  await hostnameApi('/activate', { method: 'POST' });
  console.log(domainSummary(await hostnameApi()));
  console.log(`Activated. Check sign-in with: check-google --base=https://${cfg.custom_hostname}`);
}

// ---- Google sign-in check -------------------------------------------------

/** Pure: client_id, redirect_uri and state from Supabase's redirect to Google, or null if it is not one. */
export function parseGoogleRedirect(location) {
  let u;
  try { u = new URL(location); } catch { return null; }
  if (u.hostname !== 'accounts.google.com') return null;
  const p = u.searchParams;
  return { clientId: p.get('client_id') || '', redirectUri: p.get('redirect_uri') || '', scope: p.get('scope') || '', state: p.get('state') || '' };
}

/**
 * Pure: where Supabase will send the user back after Google, read from the
 * payload of its state token (not verified: it is only for reporting, and it
 * is public in the sign-in URL anyway). Supabase falls back to the site URL
 * when the requested address is not in the redirect allow-list.
 */
export function stateReferrer(state) {
  const part = String(state || '').split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json.referrer === 'string' ? json.referrer : typeof json.redirect_to === 'string' ? json.redirect_to : null;
  } catch { return null; }
}

/** Pure: Google's verdict on the client and callback, from one response (status, URL, body). */
export function googleVerdict(status, pageUrl, body) {
  let text = String(body || '');
  try {
    const u = new URL(pageUrl);
    const authError = u.searchParams.get('authError');
    if (authError) text += ' ' + Buffer.from(authError.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (/\/oauth\/error/.test(u.pathname) && !text) text = 'oauth error';
  } catch { /* not a URL */ }
  if (/redirect_uri_mismatch/i.test(text)) return 'redirect_uri_mismatch';
  if (/invalid_client|deleted_client|OAuth client was not found/i.test(text)) return 'invalid_client';
  if (/org_internal|admin_policy_enforced|access_denied/i.test(text)) return 'blocked';
  if (/\/oauth\/error/.test(String(pageUrl))) return 'error';
  if (status >= 200 && status < 400) return 'ok';
  return `http_${status}`;
}

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function checkGoogle(returnTo) {
  const base = (flagValue('--base') || url || `https://${ref}.supabase.co`).replace(/\/+$/, '');
  const back = returnTo || 'https://studio.hintwise.org/';
  const start = `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
  console.log(`Auth host: ${base}\nReturn to: ${back}`);

  let res = await fetch(start, { redirect: 'manual', headers: { 'user-agent': BROWSER_UA } });
  if (res.status === 401) {
    // Some gateways want the public anon key even on this browser route.
    const anon = pickAnonKey(await api(`/v1/projects/${ref}/api-keys`));
    if (anon) res = await fetch(start, { redirect: 'manual', headers: { 'user-agent': BROWSER_UA, apikey: anon } });
  }
  const location = res.headers.get('location') || '';
  const google = parseGoogleRedirect(location);
  if (!google) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    fail(`Supabase did not redirect to Google (HTTP ${res.status}${location ? `, to ${location.slice(0, 120)}` : ''}): ${body}`);
  }
  const hintwise = process.env.HINTWISE_AUTH_GOOGLE_ID;
  console.log(`Google client: ${google.clientId}${hintwise ? ` (HintWise client: ${google.clientId === hintwise ? 'yes' : 'no'})` : ''}`);
  console.log(`Callback URL Google must allow: ${google.redirectUri}`);
  console.log(`Scopes: ${google.scope}`);
  const referrer = stateReferrer(google.state);
  if (referrer) console.log(`Supabase will return the user to: ${referrer}${referrer.replace(/\/+$/, '') === back.replace(/\/+$/, '') ? '' : '  (NOT the address asked for: add it to the redirect allow-list)'}`);

  // Follow Google's own redirects (account chooser or sign-in page, or an error page).
  let pageUrl = location;
  let verdict = 'unknown';
  for (let hop = 0; hop < 6; hop++) {
    const r = await fetch(pageUrl, { redirect: 'manual', headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en' } });
    const next = r.headers.get('location');
    const body = next ? '' : await r.text().catch(() => '');
    verdict = googleVerdict(r.status, pageUrl, body);
    if (verdict !== 'ok' || !next) break;
    pageUrl = new URL(next, pageUrl).toString();
    verdict = googleVerdict(0, pageUrl, '');
    if (verdict !== 'ok' && verdict !== 'http_0') break;
  }
  if (verdict === 'http_0') verdict = 'ok';
  console.log(`Google says: ${verdict}`);
  if (verdict === 'redirect_uri_mismatch') fail(`add ${google.redirectUri} to the Google client's Authorized redirect URIs`);
  if (verdict !== 'ok') fail(`Google refused the sign-in request (${verdict})`);
  console.log('Google sign-in request accepted: a person can sign in from here.');
}

// ---- Send Email hook (auth-email-hook) -------------------------------------

/** The function secrets auth-email-hook needs before Auth may hand it every email. */
export const EMAIL_HOOK_SECRETS = ['SEND_EMAIL_HOOK_SECRET', 'RESEND_API', 'SIGN_IN_HASH_KEY'];

/** Pure: the function URL Auth calls (the project's own address, not the custom domain). */
export const emailHookUri = (projectRef) => `https://${projectRef}.supabase.co/functions/v1/auth-email-hook`;

/** Pure: the files that still call supabase.auth.signInWithOtp, whose email sign-in the hook would refuse. */
export function otpCallers(files) {
  return (Array.isArray(files) ? files : []).filter((f) => /\.signInWithOtp\s*\(/.test(String(f?.text ?? ''))).map((f) => f.path);
}

/** The app sources in this repo: <app>/src/**.{ts,tsx,js,jsx,mjs}, without node_modules, dist and the platform. */
function appSources(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push({ path: path.relative(root, full), text: fs.readFileSync(full, 'utf8') });
    }
  };
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'platform' || e.name === 'node_modules') continue;
    const src = path.join(root, e.name, 'src');
    if (fs.existsSync(src)) walk(src);
  }
  return out;
}

/**
 * Pure: what stops the hook from being switched on: the function not
 * deployed, a secret missing, or an app in this repo still calling
 * signInWithOtp (its email sign-in would stop; --allow-otp-apps overrides).
 */
export function emailHookProblems(functions, secrets, otpFiles = []) {
  const problems = [];
  for (const f of otpFiles) problems.push(`${f} still calls signInWithOtp: its email sign-in stops while the hook is on (move it to the template's sendMagicLink, or pass --allow-otp-apps)`);
  const fn = (Array.isArray(functions) ? functions : []).find((f) => f?.slug === 'auth-email-hook');
  if (!fn) problems.push('the auth-email-hook function is not deployed (deploy-function auth-email-hook)');
  else if (fn.status && fn.status !== 'ACTIVE') problems.push(`the auth-email-hook function is ${fn.status}`);
  const names = new Set((Array.isArray(secrets) ? secrets : []).map((s) => s?.name));
  for (const n of EMAIL_HOOK_SECRETS) if (!names.has(n)) problems.push(`function secret ${n} is not set (set-sign-in-secrets)`);
  return problems;
}

/**
 * Pure: the PATCH for config/auth. On: enabled, the function URL and the
 * secret (a 'v1,whsec_<base64>' value, the same as the function secret).
 * Off: only the enabled flag, so switching it on again needs a new secret.
 */
export function emailHookPatch(action, { uri, secret } = {}) {
  if (action === 'off') return { hook_send_email_enabled: false };
  if (action !== 'on') throw new Error(`email-hook: unknown action ${action}`);
  if (!uri) throw new Error('email-hook on: no function URL');
  if (!/^v1,whsec_[A-Za-z0-9+/]+=*$/.test(String(secret || ''))) throw new Error('email-hook on: SEND_EMAIL_HOOK_SECRET must be v1,whsec_<base64>');
  return { hook_send_email_enabled: true, hook_send_email_uri: uri, hook_send_email_secrets: secret };
}

async function emailHook(action = 'status') {
  const current = await api(`/v1/projects/${ref}/config/auth`);
  console.log(`Send Email hook: enabled ${current.hook_send_email_enabled === true}; uri ${current.hook_send_email_uri || '(none)'}; secret ${current.hook_send_email_secrets ? '(set)' : '(unset)'}`);
  if (action === 'status') return;
  if (action === 'check' || action === 'on') {
    const otp = flags.has('--allow-otp-apps') ? [] : otpCallers(appSources(ROOT));
    const problems = emailHookProblems(await api(`/v1/projects/${ref}/functions`), await api(`/v1/projects/${ref}/secrets`), otp);
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) fail('the Send Email hook cannot be switched on yet');
    console.log('auth-email-hook is deployed, its secrets are set, and no app in this repo calls signInWithOtp.');
    console.log('::warning::Apps outside this repo on the same project (WCV Live Together, how-of-happiness, the quiz app) are not checked: their email sign-in and sign-up stop while the hook is on.');
    if (action === 'check') return;
  }
  const dryRun = flags.has('--dry-run');
  const patch = emailHookPatch(action, { uri: emailHookUri(ref), secret: dryRun ? 'v1,whsec_DRYRUN' : process.env.SEND_EMAIL_HOOK_SECRET });
  console.log(`${dryRun ? 'Would change' : 'Changing'}:`);
  for (const [k, v] of Object.entries(patch)) console.log(`  ${k}: ${SECRET_KEY.test(k) ? '(new secret)' : JSON.stringify(v)}`);
  if (dryRun) { console.log('Dry run: nothing sent.'); return; }
  await api(`/v1/projects/${ref}/config/auth`, { method: 'PATCH', body: JSON.stringify(patch) });
  const after = await api(`/v1/projects/${ref}/config/auth`);
  console.log(`After: enabled ${after.hook_send_email_enabled === true}; uri ${after.hook_send_email_uri || '(none)'}; secret ${after.hook_send_email_secrets ? '(set)' : '(unset)'}`);
}

// ---- main -----------------------------------------------------------------

const commands = {
  inspect: () => inspect(),
  sql: () => runFile(arg),
  'apply-shared': () => applyShared(),
  migrate: () => migrate(arg),
  'expose-schema': () => exposeSchema(arg),
  'check-schema': () => checkSchema(arg),
  'configure-auth': () => configureAuth(),
  keys: () => keys(),
  usage: () => usage(arg),
  'check-google': () => checkGoogle(arg),
  'domain-setup': () => domainSetup(arg),
  'domain-status': () => domainStatus(),
  'domain-activate': () => domainActivate(),
  'email-hook': () => {
    if (arg && !['status', 'check', 'on', 'off'].includes(arg)) fail('email-hook: give status, check, on or off');
    return emailHook(arg || 'status');
  },
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
