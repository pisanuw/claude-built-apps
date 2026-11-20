#!/usr/bin/env node
/**
 * Look at, or fix, the address-type environment variables of one Netlify site
 * this repo does not deploy (PasteMD, UpvoteMe, MeetMe, MyUni).
 *
 *   node netlify-env.mjs show --site paste-md
 *       the site's primary domain, aliases and every env var: its name,
 *       whether it is secret, its contexts, and its value only when the value
 *       is a plain http(s) URL or exactly one @hintwise.org address. Anything
 *       else prints as "set", so a personal address never reaches the public
 *       log; secret values cannot be read at all.
 *   node netlify-env.mjs set --site upvoteme --key NEXTAUTH_URL --value https://upvoteme.hintwise.org [--build]
 *   node netlify-env.mjs set --site upvoteme --key AUTH_SMTP_FROM --value 'UpvoteMe <noreply@hintwise.org>' --allow address [--build]
 *       write KEY as a plain (not secret) variable in every context. A secret
 *       variable cannot be unmarked on Netlify, so an existing secret one is
 *       deleted and re-created as plain. The value is one of two kinds:
 *         url      an http(s) URL with no credentials (isPrintableUrl)
 *         address  exactly one @hintwise.org address, "name@hintwise.org" or
 *                  "Display Name <name@hintwise.org>" (checkHintwiseAddress),
 *                  and only on ADDRESS_KEYS
 *       --allow names the one kind this run may write; it defaults to url.
 *       Only the workflow's job behind the owner's approval passes
 *       --allow address. Never a secret: the value is in the workflow inputs.
 *       --build starts a build of the linked repo.
 *
 * In the workflow every step takes the run's inputs from the event file
 * (--event), not from the step's env, which the log prints. `--event --check`
 * refuses a bad request before anyone is asked to approve it, prints the
 * command, site, key and kind but never the value, needs no token, and
 * writes kind=show|url|address to $GITHUB_OUTPUT. `--event --allow url` (no
 * approval) or `--event --allow address` (after approval) then does it.
 *
 * Env: NETLIFY_AUTH_TOKEN. Run it from the "Netlify env" workflow.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ADDRESS_DOMAIN = 'hintwise.org';
/**
 * The keys an address value may be written to: the apps' sender addresses
 * (AUTH_SMTP_FROM, AUTH_FROM_EMAIL, EMAIL_FROM) and the owner's notification
 * address (ADMIN_EMAIL). Not ADMIN_EMAILS: in MeetMe and PasteMD that list
 * grants admin rights, which is not an address move.
 */
export const ADDRESS_KEYS = ['ADMIN_EMAIL', 'AUTH_FROM_EMAIL', 'AUTH_SMTP_FROM', 'EMAIL_FROM'];
export const MAX_ADDRESS_LENGTH = 100;
export const MAX_MAILBOX_LENGTH = 64;

export const SITE_RE = /^[a-z0-9-]+$/;
export const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
// Lowercase a-z and 0-9 with single . _ - between them. The groups are
// separated by characters outside them, so neither pattern can backtrack.
const MAILBOX = '[a-z0-9]+(?:[._-][a-z0-9]+)*';
// Letters and digits with single spaces or hyphens between them: only RFC 5322
// atext and spaces, so the name never needs quoting.
const NAME = '[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*';
const BARE = new RegExp(`^(${MAILBOX})@hintwise\\.org$`);
const NAMED = new RegExp(`^(${NAME}) <(${MAILBOX})@hintwise\\.org>$`);
const MAILBOX_ONLY = new RegExp(`^${MAILBOX}$`);

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

const refuse = (reason) => ({ ok: false, reason });

/**
 * Pure: whether v is exactly one address at hintwise.org, in one of two forms:
 *   name@hintwise.org
 *   Display Name <name@hintwise.org>
 * Returns { ok: true, address, name } or { ok: false, reason }. The reason
 * never repeats the value. Strict on purpose: printable ASCII only, no space
 * at either end, at most MAX_ADDRESS_LENGTH characters, one @, no comma,
 * semicolon, quote, backslash, bracket or colon, the domain exactly
 * hintwise.org in lowercase, and the mailbox at most MAX_MAILBOX_LENGTH.
 */
export function checkHintwiseAddress(v) {
  if (typeof v !== 'string') return refuse('not text');
  if (v.trim() === '') return refuse('empty');
  if (v.length > MAX_ADDRESS_LENGTH) return refuse(`longer than ${MAX_ADDRESS_LENGTH} characters`);
  if (!/^[\x20-\x7e]+$/.test(v)) return refuse('only printable ASCII: no line break, tab, control character or look-alike letter');
  if (v !== v.trim()) return refuse('a space at the start or end');
  if (/[,;"'`\\()[\]:]/.test(v) || v.split('@').length > 2)
    return refuse('exactly one address: no comma, semicolon, quote, backslash, bracket, colon or second @');
  const named = NAMED.exec(v);
  const mailbox = named ? named[2] : BARE.exec(v)?.[1];
  if (mailbox) {
    if (mailbox.length > MAX_MAILBOX_LENGTH) return refuse(`the mailbox is longer than ${MAX_MAILBOX_LENGTH} characters`);
    return { ok: true, address: `${mailbox}@${ADDRESS_DOMAIN}`, name: named ? named[1] : '' };
  }
  // Not a match: say which part is wrong, still without the value.
  const form = 'use name@hintwise.org or Display Name <name@hintwise.org>';
  const inner = /^[^<>]* <([^<>]*)>$/.exec(v)?.[1] ?? (/[<>]/.test(v) ? '' : v);
  const at = inner.indexOf('@');
  if (at < 0) return refuse(form);
  if (inner.slice(at + 1) !== ADDRESS_DOMAIN) return refuse(`the domain must be exactly ${ADDRESS_DOMAIN}: lowercase, no subdomain, no other domain`);
  if (!MAILBOX_ONLY.test(inner.slice(0, at))) return refuse('the mailbox uses a-z and 0-9, with single . _ or - between them');
  return refuse(`${form}; the display name uses letters and digits with single spaces or hyphens between them`);
}

/** Pure: true when v is exactly one @hintwise.org address. */
export const isHintwiseAddress = (v) => checkHintwiseAddress(v).ok;

/** Pure: a value may appear in the public log only when it is one of these. */
const isPrintable = (v) => isPrintableUrl(v) || isHintwiseAddress(v);

/** Pure: one line describing an env var, never showing any other value. */
export function describeVar(e) {
  const values = (e.values || []).map((v) => {
    const ctx = `${v.context}${v.context_parameter ? ':' + v.context_parameter : ''}`;
    if (e.is_secret) return `${ctx}=secret`;
    if (v.value === undefined || v.value === null || v.value === '') return `${ctx}=empty`;
    return `${ctx}=${isPrintable(v.value) ? v.value : 'set'}`;
  });
  return `${e.key}: ${e.is_secret ? 'secret' : 'plain'}; scopes ${(e.scopes || []).join('+') || '?'}; ${values.join(' ') || 'no values'}`;
}

/** Pure: the PUT/POST body for a plain variable in every context. */
export function plainVarBody(key, value) {
  return { key, scopes: ['builds', 'functions', 'runtime', 'post_processing'], is_secret: false, values: [{ context: 'all', value }] };
}

/**
 * Pure: the kind of a request, 'show', 'url' or 'address', or a throw saying
 * why it is refused. No message repeats the value.
 */
export function classifyRequest({ command, site, key, value }) {
  if (command !== 'show' && command !== 'set') throw new Error('command must be show or set');
  if (!site || !SITE_RE.test(site)) throw new Error('bad site name: use the part before .netlify.app (a-z, 0-9 and -)');
  if (command === 'show') return 'show';
  if (!key || !KEY_RE.test(key)) throw new Error('bad key: use A-Z, 0-9 and _, e.g. NEXTAUTH_URL');
  if (isPrintableUrl(value)) return 'url';
  const a = checkHintwiseAddress(value);
  if (!a.ok) throw new Error(`set takes an http(s) URL or exactly one @hintwise.org address, and this value is neither (${a.reason})`);
  if (!ADDRESS_KEYS.includes(key)) throw new Error(`an @hintwise.org address can be set only on ${ADDRESS_KEYS.join(', ')}`);
  return 'address';
}

const flag = (argv, name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** Pure: a request from the command line: show|set --site S [--key K --value V] [--build]. */
export function requestFromArgv(argv) {
  return { command: argv[0], site: flag(argv, 'site'), key: flag(argv, 'key'), value: flag(argv, 'value'), build: argv.includes('--build') };
}

/** Pure: a request from a workflow_dispatch event's inputs. The value is kept exactly as typed. */
export function requestFromEvent(event) {
  const i = event?.inputs ?? {};
  const text = (x) => (x === undefined || x === null ? '' : String(x));
  return {
    command: text(i.command).trim(),
    site: text(i.site).trim(),
    key: text(i.key).trim(),
    value: text(i.value),
    build: i.build === true || i.build === 'true',
  };
}

const KIND_TEXT = {
  show: 'read-only',
  url: 'an http(s) URL value, no approval needed',
  address: "one @hintwise.org address value; the next job waits for the owner's approval",
};

/**
 * Run one request. argv is process.argv.slice(2). With --check it only
 * classifies (no token, no API call). Otherwise it writes only the kind that
 * --allow names (default url), so an address is never written by the job
 * that has no approval gate.
 */
export async function run(argv, { env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  let req;
  if (argv.includes('--event')) {
    if (!env.GITHUB_EVENT_PATH) throw new Error('--event needs GITHUB_EVENT_PATH: run it from the workflow');
    req = requestFromEvent(JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')));
  } else {
    req = requestFromArgv(argv);
  }
  const kind = classifyRequest(req);

  if (argv.includes('--check')) {
    log(`Request: ${req.command} on ${req.site}${kind === 'show' ? '' : `, key ${req.key}`}: ${KIND_TEXT[kind]}.`);
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `kind=${kind}\n`);
    return kind;
  }

  const allow = flag(argv, 'allow') ?? 'url';
  if (allow !== 'url' && allow !== 'address') throw new Error('--allow takes url or address');
  if (kind !== 'show' && kind !== allow) {
    throw new Error(kind === 'address'
      ? "an @hintwise.org address is written only by the job behind the owner's approval (--allow address)"
      : 'this job writes only @hintwise.org addresses; a URL goes through the job without approval');
  }
  const token = env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error('NETLIFY_AUTH_TOKEN is not set');

  const netlify = async (route, init = {}) => {
    const res = await fetchImpl(`https://api.netlify.com/api/v1${route}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${route} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };

  const info = await netlify(`/sites/${req.site}.netlify.app`);
  const envRoute = `/accounts/${info.account_id}/env`;
  const list = async () => netlify(`${envRoute}?site_id=${info.id}`);
  log(`Site ${info.name}: primary ${info.custom_domain || 'none'}; aliases ${(info.domain_aliases || []).join(', ') || 'none'}; url ${info.url}; ssl_url ${info.ssl_url}`);

  if (kind === 'show') {
    const envs = await list();
    log(`${envs.length} env var(s):`);
    for (const e of envs.sort((a, b) => a.key.localeCompare(b.key))) log(`  ${describeVar(e)}`);
    // Env changes reach functions only with a new deploy, so show the last few.
    const deploys = await netlify(`/sites/${info.id}/deploys?per_page=5`);
    log('Recent deploys:');
    for (const d of deploys) {
      const live = d.id === info.published_deploy?.id ? ' (live)' : '';
      log(`  ${d.created_at} ${d.state}${live} ${d.context || ''} ${d.error_message ? '- ' + String(d.error_message).slice(0, 200) : ''}`);
    }
    return kind;
  }

  const { key, value } = req;
  const existing = (await list()).find((e) => e.key === key);
  const q = `?site_id=${info.id}`;
  if (existing?.is_secret) {
    await netlify(`${envRoute}/${key}${q}`, { method: 'DELETE' });
    log(`Deleted secret ${key} (Netlify cannot unmark a secret).`);
  }
  if (existing && !existing.is_secret) {
    await netlify(`${envRoute}/${key}${q}`, { method: 'PUT', body: JSON.stringify(plainVarBody(key, value)) });
  } else {
    await netlify(`${envRoute}${q}`, { method: 'POST', body: JSON.stringify([plainVarBody(key, value)]) });
  }
  const after = (await list()).find((e) => e.key === key);
  if (!after || after.is_secret || !(after.values || []).some((v) => v.value === value))
    throw new Error(`${key} did not come back as plain with the new value`);
  log(`Set ${describeVar(after)}`);
  if (req.build) {
    if (!info.build_settings?.repo_url) log('::warning::no linked repo, so no build started');
    else {
      await netlify(`/sites/${info.id}/builds`, { method: 'POST', body: '{}' });
      log('Build started.');
    }
  }
  return kind;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((e) => {
    console.log(`::error::${String(e.message || e).slice(0, 400)}`);
    process.exit(1);
  });
}
