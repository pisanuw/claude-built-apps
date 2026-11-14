/**
 * The app's server routes (Netlify Function `api`, served at /api/*):
 *
 * - GET  /api/health      -> {ok: true, status: 'ok'} (the deploy runner looks for "status")
 * - POST /api/link-check  -> a LinkResult for {url}, signed-in callers only,
 *   at most LINK_TESTS_PER_HOUR per user. The limit is the insert trigger on
 *   app_delivery_canary.link_tests (atomic per user); the function records
 *   the test first and fetches only when the database accepted it.
 * - POST /api/seed-check   -> signs in to the shop's seed Gmail account over
 *   IMAP and returns the newest delivery email and where Gmail put it
 *   (handleSeedCheck below). Signed-in callers only; 12 an hour per user and
 *   20 an hour per seed address (the seed_checks insert trigger).
 *
 * The function acts with the caller's own Supabase token, so row level
 * security applies to everything it reads or writes. Its one secret,
 * DELIVERY_CANARY_KEY, only seals and opens kept app passwords.
 */
import type { LinkResult } from '../core/types';
import { cleanPassword, DEFAULT_DAYS, SeedError, seedQueryProblem, type SeedErrorCode, type SeedQuery, type SeedResult } from './seed';
import { addressTag, open, seal, seedAad } from './secretbox';
import type { SeedSave } from './supabase-rest';

export const LINK_TESTS_PER_HOUR = 30;
export const MAX_URL_LENGTH = 2048;

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  /** The user id for a session token, or null when the token is not valid. */
  verifyUser(token: string): Promise<string | null>;
  /** Records one test; 'limited' when the user is at the hourly limit. */
  record(token: string, host: string): Promise<'ok' | 'limited'>;
  fetchFile(url: string): Promise<LinkResult>;
  seed: SeedDeps;
}

export interface SeedDeps {
  /** The key that seals kept app passwords; null when DELIVERY_CANARY_KEY is not set (then nothing is kept). */
  key: Buffer | null;
  record(token: string, addressTag: string): Promise<'ok' | 'limited'>;
  secret(token: string, shopId: string): Promise<string | null>;
  save(token: string, s: SeedSave): Promise<boolean>;
  check(q: SeedQuery): Promise<SeedResult>;
  /** Whether imap.gmail.com answers (greeting only, no sign-in). */
  reachable(): Promise<boolean>;
}

/** The reachability probe is public, so its answer is reused for a minute per function instance. */
const REACH_TTL_MS = 60_000;
let reachCache: { at: number; ok: boolean } | null = null;
export function resetReachCache(): void {
  reachCache = null;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

export function bearer(headers: Record<string, string | undefined>): string {
  const h = headers.authorization ?? headers.Authorization ?? '';
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(h.trim());
  return m ? m[1] : '';
}

export async function handleApi(method: string, path: string, bodyText: string | null, headers: Record<string, string | undefined>, deps: ApiDeps): Promise<ApiResponse> {
  const route = path.replace(/^\/\.netlify\/functions\/api/, '/api').replace(/\/+$/, '');
  if (route === '/api/health') return json(200, { ok: true, status: 'ok', seedKeep: deps.seed.key !== null });
  if (route === '/api/seed-reach') {
    const now = Date.now();
    if (!reachCache || now - reachCache.at > REACH_TTL_MS) reachCache = { at: now, ok: await deps.seed.reachable() };
    return json(200, { gmailImap: reachCache.ok });
  }
  if (route === '/api/seed-check') return method === 'POST' ? handleSeedCheck(bodyText, headers, deps) : json(405, { error: 'Use POST.' });
  if (route !== '/api/link-check') return json(404, { error: 'Not found.' });
  if (method !== 'POST') return json(405, { error: 'Use POST.' });

  const token = bearer(headers);
  if (!token) return json(401, { error: 'Sign in to test download links.' });
  let url = '';
  try {
    const body = JSON.parse(bodyText ?? '') as { url?: unknown };
    url = typeof body.url === 'string' ? body.url.trim() : '';
  } catch {
    return json(400, { error: 'Send JSON: {"url": "..."}' });
  }
  if (!url || url.length > MAX_URL_LENGTH) return json(400, { error: 'Send the download link to test (at most 2,048 characters).' });
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return json(400, { error: 'Only web links (http or https) can be tested.' });
    host = u.hostname.slice(0, 253);
  } catch {
    return json(400, { error: 'That is not a valid link.' });
  }

  try {
    const user = await deps.verifyUser(token);
    if (!user) return json(401, { error: 'Your session has ended. Sign in again to test links.' });
    if ((await deps.record(token, host)) === 'limited') {
      return json(429, { error: `You have tested ${LINK_TESTS_PER_HOUR} links in the last hour. Try again later.` });
    }
  } catch {
    return json(503, { error: 'The link test is unavailable right now. Try again in a minute.' });
  }
  return json(200, await deps.fetchFile(url));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Codes that mean Gmail refused the sign-in itself (a typed password is then not kept). */
const LOGIN_CODES: SeedErrorCode[] = ['login-failed', 'needs-app-password', 'web-login', 'imap-off'];

export interface SeedCheckBody {
  shopId: string;
  address: string;
  sender: string;
  subject: string;
  /** Typed now; '' to use the kept one. */
  password: string;
  /** Keep the typed password (sealed) for this shop's later checks. */
  remember: boolean;
  days: number;
}

/** Reads and normalises the request body; a string is the problem in plain words. */
export function parseSeedBody(bodyText: string | null): SeedCheckBody | string {
  let b: Record<string, unknown>;
  try {
    const v = JSON.parse(bodyText ?? '') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Send JSON with shopId, address, sender and password.';
    b = v as Record<string, unknown>;
  } catch {
    return 'Send JSON with shopId, address, sender and password.';
  }
  const text = (k: string, max: number) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');
  const out: SeedCheckBody = {
    shopId: text('shopId', 64),
    address: text('address', 300).toLowerCase(),
    sender: text('sender', 300).toLowerCase(),
    subject: text('subject', 200).replace(/\s+/g, ' '),
    password: typeof b.password === 'string' ? cleanPassword(b.password.slice(0, 200)) : '',
    remember: b.remember === true,
    days: b.days === undefined ? DEFAULT_DAYS : typeof b.days === 'number' ? b.days : NaN,
  };
  if (!UUID_RE.test(out.shopId)) return 'Save the shop first, then check its seed inbox.';
  const problem = seedQueryProblem({ ...out, password: out.password || 'kept-password' });
  return problem || out;
}

export async function handleSeedCheck(bodyText: string | null, headers: Record<string, string | undefined>, deps: ApiDeps): Promise<ApiResponse> {
  const token = bearer(headers);
  if (!token) return json(401, { error: 'Sign in to check your seed inbox.' });
  const body = parseSeedBody(bodyText);
  if (typeof body === 'string') return json(400, { error: body });
  const { seed } = deps;

  let password = body.password;
  let userId = '';
  try {
    const user = await deps.verifyUser(token);
    if (!user) return json(401, { error: 'Your session has ended. Sign in again to check your seed inbox.' });
    userId = user;
    if (!password) {
      if (!seed.key) return json(400, { error: 'Paste the app password: this server does not keep passwords yet.', outcome: 'no-password' });
      const sealed = await seed.secret(token, body.shopId);
      const opened = sealed ? open(seed.key, sealed, seedAad(user, body.shopId, body.address)) : null;
      if (!opened) {
        return json(400, {
          error: sealed ? 'The kept app password is for another address, or can no longer be read. Paste the app password again.' : 'No app password is kept for this shop. Paste it to check.',
          outcome: 'no-password',
        });
      }
      password = opened;
    }
    if ((await seed.record(token, addressTag(body.address))) === 'limited') {
      return json(429, { error: 'Too many seed inbox checks in the last hour (12 per account, 20 per seed address). Try again later.' });
    }
  } catch {
    return json(503, { error: 'The seed inbox check is unavailable right now. Try again in a minute.' });
  }

  let result: SeedResult | null = null;
  let failure: SeedError | null = null;
  try {
    result = await seed.check({ address: body.address, password, sender: body.sender, subject: body.subject, days: body.days });
  } catch (e) {
    failure = e instanceof SeedError ? e : new SeedError('protocol', 'The seed inbox check failed. Try again in a minute.');
  }
  const outcome = result ? (result.found ? 'found' : 'not-found') : failure!.code;

  // What happens to the kept password: a typed one is kept (sealed) only
  // when asked, only with a key, and only once Gmail accepted it.
  let mode: SeedSave['secretMode'] = 'keep';
  let sealed: string | null = null;
  if (body.password) {
    if (!body.remember || !seed.key) mode = 'clear';
    else if (result) {
      mode = 'set';
      sealed = seal(seed.key, body.password, seedAad(userId, body.shopId, body.address));
    }
  }
  let kept = false;
  let saved = true;
  try {
    kept = await seed.save(token, { shopId: body.shopId, address: body.address, sender: body.sender, subject: body.subject, secretMode: mode, secret: sealed, outcome });
  } catch {
    saved = false;
  }

  if (failure) {
    const status = LOGIN_CODES.includes(failure.code) ? 422 : 502;
    return json(status, { error: failure.message, outcome, kept, saved });
  }
  return json(200, { ...result, outcome, kept, saved });
}
