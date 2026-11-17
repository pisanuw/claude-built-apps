/**
 * The command-line tool's client for the live app: it signs a terminal in to
 * HintWise and calls the LLM gateway as that person, within their allowance.
 *
 * Sign-in: the /terminal/ page asks the platform for a sign-in link that
 * returns to /terminal/, where the one-time code is shown instead of used.
 * The tool redeems it with Auth's verify endpoint (what supabase-js
 * verifyOtp does), so the terminal gets a session of its own, separate from
 * any browser's. Each run refreshes it when it is about to expire.
 *
 * No Node or npm imports: fetch, the clock and the session file are passed in.
 */
import type { Generate, Usage } from './alt-text.ts';
import { capMessage } from './caps.ts';
import { InputError } from './request.ts';

/** The gateway's app row; the same as src/lib/supabase.ts APP_SLUG (a test checks). */
export const APP = 'lewis-alt-text';
export const TERMINAL_URL = 'https://lewis-alt-text.hintwise.org/terminal/';
/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000;

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  email: string | null;
}

export interface SessionStore {
  load(): Promise<Session | null>;
  save(s: Session): Promise<void>;
  clear(): Promise<void>;
}

export interface RemoteOptions {
  supabaseUrl: string;
  anonKey: string;
  store: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface Allowance {
  allowed: boolean;
  callsLeft: number | null;
  scope: string | null;
  resetsAt: string | null;
}

/** Not signed in, or the session has ended: the message says to run login. */
export class SignedOut extends Error {
  constructor(message = 'This terminal is not signed in to HintWise. Run: lewis-alt-text login') {
    super(message);
    this.name = 'SignedOut';
  }
}

// Plain fields, not constructor parameter properties: Node's type stripping cannot run those.
export class CapReachedError extends Error {
  readonly scope: string;
  readonly resetsAt: string | null;
  constructor(scope: string, resetsAt: string | null) {
    super(capMessage(scope, resetsAt));
    this.name = 'CapReachedError';
    this.scope = scope;
    this.resetsAt = resetsAt;
  }
}

export class RemoteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RemoteError';
    this.status = status;
  }
}

const CODE = /^[A-Za-z0-9_-]{16,256}$/;

/** The code from what the person pasted: the code itself, or the whole link from the email. */
export function parseCode(input: string): string {
  let t = input.trim();
  if (!t) throw new InputError('Paste the code from the terminal page, or the whole link from the sign-in email.');
  if (/^https?:\/\//i.test(t)) {
    let url: URL;
    try {
      url = new URL(t);
    } catch {
      throw new InputError('That does not look like a link. Paste the code from the terminal page instead.');
    }
    const hash = url.searchParams.get('token_hash');
    if (!hash) throw new InputError('That link has no sign-in code in it. Use the link from the HintWise sign-in email.');
    t = hash;
  }
  if (!CODE.test(t)) throw new InputError('That is not a sign-in code. Copy it again from the terminal page.');
  return t;
}

/** A Session from Auth's JSON answer (verify or refresh). */
export function sessionFromAuth(data: unknown, now: number): Session {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const access = d.access_token;
  const refresh = d.refresh_token;
  if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) {
    throw new RemoteError(502, 'The sign-in service answered without a session.');
  }
  const expiresAt =
    typeof d.expires_at === 'number' ? d.expires_at * 1000 : now + (typeof d.expires_in === 'number' ? d.expires_in : 3600) * 1000;
  const user = (typeof d.user === 'object' && d.user !== null ? d.user : {}) as Record<string, unknown>;
  return { accessToken: access, refreshToken: refresh, expiresAt, email: typeof user.email === 'string' ? user.email : null };
}

function messageOf(data: unknown, fallback: string): string {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  for (const k of ['message', 'msg', 'error_description', 'error']) {
    if (typeof d[k] === 'string' && d[k]) return d[k] as string;
  }
  return fallback;
}

export function createRemote(o: RemoteOptions) {
  const base = o.supabaseUrl.replace(/\/+$/, '');
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const authHeaders = { apikey: o.anonKey, 'content-type': 'application/json' };

  async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; ok: boolean; data: unknown }> {
    let res: Response;
    try {
      res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new RemoteError(0, `Could not reach HintWise: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { status: res.status, ok: res.ok, data: await res.json().catch(() => null) };
  }

  /** Redeems a one-time code for this terminal's own session, and saves it. */
  async function verify(code: string): Promise<Session> {
    const r = await post(`${base}/auth/v1/verify`, authHeaders, { type: 'email', token_hash: parseCode(code) });
    if (r.status >= 400 && r.status < 500) {
      throw new InputError('That code has expired or was already used. Ask for a new link on the terminal page.');
    }
    if (!r.ok) throw new RemoteError(r.status, messageOf(r.data, `The sign-in service answered ${r.status}.`));
    const s = sessionFromAuth(r.data, now());
    await o.store.save(s);
    return s;
  }

  async function refresh(s: Session): Promise<Session> {
    const r = await post(`${base}/auth/v1/token?grant_type=refresh_token`, authHeaders, { refresh_token: s.refreshToken });
    if (r.status >= 400 && r.status < 500) {
      await o.store.clear();
      throw new SignedOut('Your HintWise sign-in in this terminal has ended. Run: lewis-alt-text login');
    }
    if (!r.ok) throw new RemoteError(r.status, messageOf(r.data, `The sign-in service answered ${r.status}.`));
    const next = sessionFromAuth(r.data, now());
    if (!next.email) next.email = s.email;
    await o.store.save(next);
    return next;
  }

  /** The saved session, refreshed when it is about to expire (or when forced). */
  async function session(force = false): Promise<Session> {
    const s = await o.store.load();
    if (!s) throw new SignedOut();
    return force || s.expiresAt - now() < REFRESH_MARGIN_MS ? refresh(s) : s;
  }

  async function gateway(body: Record<string, unknown>, retried = false): Promise<Record<string, unknown>> {
    const s = await session();
    const r = await post(`${base}/functions/v1/llm-gateway`, { authorization: `Bearer ${s.accessToken}`, 'content-type': 'application/json' }, { app: APP, ...body });
    const d = (typeof r.data === 'object' && r.data !== null ? r.data : {}) as Record<string, unknown>;
    if (r.status === 401 && !retried) {
      await session(true); // a refreshed token, then once more
      return gateway(body, true);
    }
    if (r.status === 401) throw new SignedOut('HintWise no longer accepts this terminal\'s sign-in. Run: lewis-alt-text login');
    if (r.status === 429 && d.error === 'cap') {
      throw new CapReachedError(String(d.scope ?? 'app-day'), typeof d.resets_at === 'string' ? d.resets_at : null);
    }
    if (!r.ok) throw new RemoteError(r.status, `The HintWise gateway refused the call: ${messageOf(d, `HTTP ${r.status}`)}`);
    return d;
  }

  /** One model call through the gateway, in the shape writeAltText expects. */
  const generate: Generate = async (req) => {
    const m = await gateway({ model: req.model, max_tokens: req.max_tokens, system: req.system, messages: req.messages });
    const content = Array.isArray(m.content) ? (m.content as Array<{ type?: unknown; text?: unknown }>) : [];
    const text = content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
    return {
      text,
      model: typeof m.model === 'string' ? m.model : undefined,
      stopReason: typeof m.stop_reason === 'string' ? m.stop_reason : null,
      usage: (m.usage ?? undefined) as Usage | undefined,
    };
  };

  /** What is left of this person's allowance (the gateway's free check mode). */
  async function check(): Promise<Allowance> {
    const d = await gateway({ check: true });
    return {
      allowed: d.allowed === true,
      callsLeft: typeof d.calls_left === 'number' ? d.calls_left : null,
      scope: typeof d.scope === 'string' ? d.scope : null,
      resetsAt: typeof d.resets_at === 'string' ? d.resets_at : null,
    };
  }

  /** Ends this terminal's session on the server too (best effort) and forgets it. False when none was saved. */
  async function logout(): Promise<boolean> {
    const s = await o.store.load();
    if (!s) return false;
    try {
      await post(`${base}/auth/v1/logout?scope=local`, { apikey: o.anonKey, authorization: `Bearer ${s.accessToken}` }, {});
    } catch {
      // Offline: the saved session is still forgotten below.
    }
    await o.store.clear();
    return true;
  }

  return { verify, session, generate, check, logout };
}
