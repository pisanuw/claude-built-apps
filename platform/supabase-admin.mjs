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
 *                           (used for platform/supabase/shared/*.sql and an
 *                           app's <slug>/supabase/migrations/*.sql)
 *
 * Env: SUPABASE_ACCESS_TOKEN (personal access token), and SUPABASE_URL
 * (https://<ref>.supabase.co) or SUPABASE_PROJECT_REF.
 */
import fs from 'node:fs';

const API = 'https://api.supabase.com';
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF
  || (process.env.SUPABASE_URL || '').match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
const [cmd, arg] = process.argv.slice(2);

if (!token) fail('SUPABASE_ACCESS_TOKEN is not set');
if (!ref) fail('SUPABASE_PROJECT_REF or SUPABASE_URL (https://<ref>.supabase.co) is not set');

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

// Runs SQL through the Management API; returns the rows of the last statement.
async function sql(query) {
  return api(`/v1/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query }) });
}

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
}

async function runFile(file) {
  if (!file || !fs.existsSync(file)) fail(`sql: file not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  console.log(`Running ${file} (${text.length} chars)`);
  const rows = await sql(text);
  console.log(`Done. ${Array.isArray(rows) ? rows.length : 0} row(s) returned.`);
  if (Array.isArray(rows) && rows.length) table(rows.slice(0, 50));
}

try {
  if (cmd === 'inspect') await inspect();
  else if (cmd === 'sql') await runFile(arg);
  else fail(`unknown command ${cmd}; use inspect or sql <file>`);
} catch (e) {
  fail(String(e.message || e).slice(0, 500));
}
