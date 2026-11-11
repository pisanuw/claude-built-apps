/**
 * The email-optout function (supabase/functions/email-optout): the page
 * behind "Stop all email from HintWise", and the support commands
 * (supabase-admin.mjs email-optout status|remove). Contract in
 * src/signin/README.md, design in docs/platform.md ("Email footer and
 * opt-out").
 *
 *   GET  ?t=<token>          a page asking "Stop all email from HintWise to
 *                            this address?" with a confirm button. Changes
 *                            nothing and reads nothing (mail scanners open
 *                            links). HEAD: the same headers, no body.
 *   POST t=<token>&action=stop|undo   (a plain HTML form, no JavaScript)
 *                            stop puts the address on the list, undo takes
 *                            it off; both idempotent. The page says "Done"
 *                            with an Undo button, or "Email is on again"
 *                            with the stop button.
 *   POST application/json with Authorization: Bearer <service-role key>
 *        { action: 'status' | 'remove', email }
 *                            support: the address is hashed here, under
 *                            SIGN_IN_HASH_KEY like the sign-in log, and the
 *                            RPC runs with the caller's own key, so only a
 *                            service-role key gets an answer (Postgres
 *                            grants, not this code, decide). The answer
 *                            never contains the address.
 *
 * HTML is served on the custom domain (auth.hintwise.org); Supabase rewrites
 * a GET's text/html to text/plain on *.supabase.co (supabase.com/docs/guides/functions/limits).
 * Every page: no script, CSP default-src 'none', no framing, no referrer,
 * no caching, noindex. Only a token that verified is echoed into a page.
 */
import { restDb, type Db } from './db.ts';
import { escapeHtml, SUPPORT_EMAIL } from './email.ts';
import { hashKeys, shortHash } from './keys.ts';
import { verifyOptOutToken } from './optout.ts';
import { errorText, readBody } from './util.ts';
import { normalizeEmail } from './validate.ts';

export interface OptOutEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Hashes the address of a support command, as the sign-in log does. */
  SIGN_IN_HASH_KEY?: string;
  /** Checks the tokens of the footer links. */
  EMAIL_OPTOUT_SECRET?: string;
}

export interface OptOutDeps {
  env: OptOutEnv;
  fetch: typeof fetch;
  /** The page's database (service role). Default: PostgREST with SUPABASE_SERVICE_ROLE_KEY. */
  db?: Db;
  /** The database for a support command, with the caller's key. Default: PostgREST with that key. */
  dbAs?: (key: string) => Db;
  log?: (message: string) => void;
}

/** The form posts here: a path, so the page works on the custom domain and on the project address alike. */
export const OPTOUT_PATH = '/functions/v1/email-optout';
/** A form or a support command is a few hundred bytes. */
export const MAX_OPTOUT_BODY = 4096;

export type PageKind = 'confirm' | 'stopped' | 'restored' | 'invalid' | 'error' | 'unavailable';

const PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-robots-tag': 'noindex, nofollow',
};

const CSS = [
  ':root{color-scheme:light dark}',
  'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;margin:0;padding:32px 16px}',
  'main{max-width:34rem;margin:0 auto}',
  'h1{font-size:1.4rem;line-height:1.3;margin:0 0 12px}',
  'button{font:inherit;font-weight:600;padding:10px 18px;border-radius:6px;border:2px solid #1d4ed8;background:#1d4ed8;color:#ffffff;cursor:pointer}',
  'button.quiet{background:transparent;color:inherit}',
  'button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}',
  '.small{font-size:0.9rem}',
].join('');

const supportLink = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;

/** One form: the verified token and the action, posted to the function. */
function form(token: string, action: 'stop' | 'undo', label: string, quiet = false): string {
  return (
    `<form method="post" action="${OPTOUT_PATH}">` +
    `<input type="hidden" name="t" value="${escapeHtml(token)}">` +
    `<input type="hidden" name="action" value="${action}">` +
    `<button type="submit"${quiet ? ' class="quiet"' : ''}>${label}</button>` +
    '</form>'
  );
}

/** The page for one state. `token` is used only by the pages with a form, and only after it verified. */
export function optOutPage(kind: PageKind, token = ''): { title: string; html: string } {
  let title: string;
  let body: string;
  if (kind === 'confirm') {
    title = 'Stop all email from HintWise to this address?';
    body = `<p>This includes sign-in links; you can still sign in with Google.</p>${form(token, 'stop', 'Stop all email')}`;
  } else if (kind === 'stopped') {
    title = 'Done';
    body = `<p>HintWise will send no more email to this address, sign-in links included. You can still sign in with Google.</p>${form(token, 'undo', 'Undo', true)}`;
  } else if (kind === 'restored') {
    title = 'Email from HintWise is on again';
    body = `<p>This address gets HintWise email again, sign-in links included.</p>${form(token, 'stop', 'Stop all email', true)}`;
  } else if (kind === 'invalid') {
    title = 'This link does not work';
    body = `<p>Open the whole link from the email (some apps cut long links), or write to ${supportLink} and we will stop the email for you.</p>`;
  } else if (kind === 'unavailable') {
    title = 'This page is not ready yet';
    body = `<p>Write to ${supportLink} and we will stop the email for you.</p>`;
  } else {
    title = 'Something went wrong';
    body = `<p>Nothing was changed. Try again in a minute, or write to ${supportLink}.</p>`;
  }
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">' +
    `<title>${escapeHtml(title)} - HintWise</title><style>${CSS}</style></head>` +
    `<body><main><h1>${escapeHtml(title)}</h1>${body}` +
    `<p class="small">Questions? ${supportLink}</p></main></body></html>`;
  return { title, html };
}

const STATUS: Record<PageKind, number> = { confirm: 200, stopped: 200, restored: 200, invalid: 400, error: 500, unavailable: 503 };

function page(kind: PageKind, token = '', head = false): Response {
  return new Response(head ? null : optOutPage(kind, token).html, { status: STATUS[kind], headers: PAGE_HEADERS });
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * A quick refusal of keys that cannot be the service role: an anon or user
 * JWT (read without verifying) or a publishable key. Anything else goes to
 * PostgREST, whose grants decide.
 */
export function mayBeServiceKey(key: string): boolean {
  if (!key || key.length > 4096 || key.startsWith('sb_publishable_')) return false;
  const parts = key.split('.');
  if (parts.length !== 3) return key.startsWith('sb_secret_');
  try {
    const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

export async function handleOptOut(req: Request, deps: OptOutDeps): Promise<Response> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  try {
    if (req.method === 'GET' || req.method === 'HEAD') return await showPage(req, deps);
    if (req.method === 'POST') {
      const type = (req.headers.get('content-type') ?? '').toLowerCase();
      return type.startsWith('application/json') ? await support(req, deps, log) : await submit(req, deps, log);
    }
    return new Response('Use GET or POST.', { status: 405, headers: { ...PAGE_HEADERS, 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD, POST' } });
  } catch (e) {
    log(`email-optout failed: ${errorText(e)}`);
    return page('error');
  }
}

/** GET and HEAD: verify the token and show the question. No database. */
async function showPage(req: Request, deps: OptOutDeps): Promise<Response> {
  const head = req.method === 'HEAD';
  if (!deps.env.EMAIL_OPTOUT_SECRET) return page('unavailable', '', head);
  const token = new URL(req.url).searchParams.get('t');
  const check = await verifyOptOutToken(deps.env.EMAIL_OPTOUT_SECRET, token);
  return check.ok ? page('confirm', token as string, head) : page('invalid', '', head);
}

/** The form: stop or undo, for the address the token names. */
async function submit(req: Request, deps: OptOutDeps, log: (m: string) => void): Promise<Response> {
  const env = deps.env;
  if (!env.EMAIL_OPTOUT_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    log('email-optout is not configured: EMAIL_OPTOUT_SECRET, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset');
    return page('unavailable');
  }
  const text = await readBody(req, MAX_OPTOUT_BODY);
  if (text === null) return page('invalid');
  const fields = new URLSearchParams(text);
  const token = fields.get('t') ?? '';
  const action = fields.get('action');
  const check = await verifyOptOutToken(env.EMAIL_OPTOUT_SECRET, token);
  if (!check.ok || (action !== 'stop' && action !== 'undo')) return page('invalid');
  const db = deps.db ?? restDb(deps.fetch, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    if (action === 'stop') await db.rpc('email_optout_set', { p_email_hash: check.emailHash, p_scope: check.scope, p_via: 'link' });
    else await db.rpc('email_optout_clear', { p_email_hash: check.emailHash, p_scope: check.scope });
  } catch (e) {
    log(`email-optout: ${action} failed for ${shortHash(check.emailHash)}: ${errorText(e)}`);
    return page('error');
  }
  return page(action === 'stop' ? 'stopped' : 'restored', token);
}

export type SupportAnswer =
  | { ok: true; action: 'status'; optedOut: boolean; entries: Array<{ scope: string; via: string; since: string }>; hash: string }
  | { ok: true; action: 'remove'; removed: number; hash: string }
  | { ok: false; error: string };

/** A support command: status or remove for one address, with the caller's key. */
async function support(req: Request, deps: OptOutDeps, log: (m: string) => void): Promise<Response> {
  const env = deps.env;
  const auth = req.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key) return json(401, { ok: false, error: 'Send Authorization: Bearer <service-role key>.' } satisfies SupportAnswer);
  if (!mayBeServiceKey(key)) return json(403, { ok: false, error: 'Only the service-role key may do this.' } satisfies SupportAnswer);
  if (!env.SUPABASE_URL || !env.SIGN_IN_HASH_KEY) {
    log('email-optout support command: SUPABASE_URL or SIGN_IN_HASH_KEY unset');
    return json(503, { ok: false, error: 'email-optout is not configured.' } satisfies SupportAnswer);
  }
  const text = await readBody(req, MAX_OPTOUT_BODY);
  let body: { action?: unknown; email?: unknown } = {};
  try {
    body = JSON.parse(text ?? '') as typeof body;
  } catch {
    /* refused below */
  }
  const email = normalizeEmail(body?.email);
  const action = body?.action;
  if (!email || (action !== 'status' && action !== 'remove')) return json(400, { ok: false, error: 'Send { action: "status" | "remove", email }.' } satisfies SupportAnswer);
  const hash = (await hashKeys(env.SIGN_IN_HASH_KEY, { email })).email_hash as string;
  const db = deps.dbAs ? deps.dbAs(key) : restDb(deps.fetch, env.SUPABASE_URL, key);
  try {
    if (action === 'status') {
      const rows = await db.rpc<Array<{ scope: string; via: string; since: string }> | null>('email_optout_status', { p_email_hash: hash });
      const entries = Array.isArray(rows) ? rows : [];
      return json(200, { ok: true, action, optedOut: entries.length > 0, entries, hash: shortHash(hash) } satisfies SupportAnswer);
    }
    const removed = await db.rpc<number>('email_optout_clear', { p_email_hash: hash, p_scope: null });
    return json(200, { ok: true, action, removed: typeof removed === 'number' ? removed : 0, hash: shortHash(hash) } satisfies SupportAnswer);
  } catch (e) {
    const msg = errorText(e);
    // PostgREST refuses a key without the grant (anon, a user) with 401 or 403.
    if (/HTTP 40[13]\b/.test(msg)) return json(403, { ok: false, error: 'Only the service-role key may do this.' } satisfies SupportAnswer);
    log(`email-optout support ${action} failed for ${shortHash(hash)}: ${msg}`);
    return json(500, { ok: false, error: 'The database call failed.' } satisfies SupportAnswer);
  }
}
