import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/signin/db.ts';
import {
  appOptOutToken,
  appOptOutUrl,
  appUndoToken,
  MAX_APP_TOKEN_CHARS,
  OPTOUT_URL,
  optOutToken,
  signedText,
  UNDO_SECONDS,
  undoToken,
  verifyAppOptOutToken,
  verifyAppUndoToken,
  verifyOptOutToken,
  verifyUndoToken,
} from '../src/signin/optout.ts';
import { handleOptOut, optOutPage, OPTOUT_PATH, type OptOutDeps, type OptOutEnv } from '../src/signin/optout-service.ts';

const SECRET = 'optout-secret';
const ANN = crypto.createHmac('sha256', 'hash-key').update('email:ann@example.com').digest('hex');
const ENV: OptOutEnv = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SIGN_IN_HASH_KEY: 'hash-key', EMAIL_OPTOUT_SECRET: SECRET };
const NOW = new Date('2026-11-13T12:00:00Z');
const mac = (text: string) => crypto.createHmac('sha256', SECRET).update(text).digest('base64url');

describe('the per-app stop token (a1)', () => {
  it('is a1.<slug>.<hash>.<HMAC over stop, a1, app:<slug>, hash> and verifies with its app and scope', async () => {
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    expect(t).toBe(`a1.stepwise.${ANN}.${mac(signedText('stop', 'a1', 'app:stepwise', ANN))}`);
    expect(await verifyAppOptOutToken(SECRET, t)).toEqual({ ok: true, emailHash: ANN, app: 'stepwise', scope: 'app:stepwise' });
    const long = await appOptOutToken(SECRET, `a${'-'.repeat(62)}`, ANN);
    expect(long.length).toBeLessThanOrEqual(MAX_APP_TOKEN_CHARS);
  });
  it('cannot be moved to another app, another version, or made from a v1 or undo signature', async () => {
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    const sig = t.split('.')[3];
    expect(await verifyAppOptOutToken(SECRET, `a1.pluck-lab.${ANN}.${sig}`)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyAppOptOutToken(SECRET, `a2.stepwise.${ANN}.${sig}`)).toEqual({ ok: false, reason: 'version' });
    const v1sig = (await optOutToken(SECRET, ANN)).split('.')[2];
    expect(await verifyAppOptOutToken(SECRET, `a1.stepwise.${ANN}.${v1sig}`)).toEqual({ ok: false, reason: 'signature' });
    const undoSig = mac(signedText('undo', 'a1', 'app:stepwise', ANN));
    expect(await verifyAppOptOutToken(SECRET, `a1.stepwise.${ANN}.${undoSig}`)).toEqual({ ok: false, reason: 'signature' });
    // A slug that tries to smuggle a scope separator does not even parse.
    expect((await verifyAppOptOutToken(SECRET, `a1.step:wise.${ANN}.${sig}`)).ok).toBe(false);
    expect(await verifyAppOptOutToken('other', t)).toEqual({ ok: false, reason: 'signature' });
  });
  it('is never a v1 or u1 token, nor they an app token', async () => {
    const a = await appOptOutToken(SECRET, 'stepwise', ANN);
    expect((await verifyOptOutToken(SECRET, a)).ok).toBe(false);
    expect((await verifyUndoToken(SECRET, a, NOW)).ok).toBe(false);
    expect((await verifyAppOptOutToken(SECRET, await optOutToken(SECRET, ANN))).ok).toBe(false);
    expect((await verifyAppUndoToken(SECRET, await undoToken(SECRET, ANN, NOW), NOW)).ok).toBe(false);
    expect((await verifyAppUndoToken(SECRET, a, NOW)).ok).toBe(false);
  });
  it('refuses bad shapes, a non-canonical signature, a missing secret, and never throws', async () => {
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const twin = t.slice(0, -1) + alphabet[alphabet.indexOf(t.at(-1)!) ^ 1];
    expect(await verifyAppOptOutToken(SECRET, twin)).toEqual({ ok: false, reason: 'format' });
    for (const bad of [null, 42, '', `${t}x`, `a1.Stepwise.${ANN}.${t.split('.')[3]}`, 'a'.repeat(MAX_APP_TOKEN_CHARS + 1)]) {
      expect((await verifyAppOptOutToken(SECRET, bad)).ok, String(bad)).toBe(false);
    }
    expect(await verifyAppOptOutToken('', t)).toEqual({ ok: false, reason: 'no secret' });
    await expect(appOptOutToken('', 'stepwise', ANN)).rejects.toThrow('no EMAIL_OPTOUT_SECRET');
    await expect(appOptOutToken(SECRET, 'Bad Slug', ANN)).rejects.toThrow('not an app slug');
    await expect(appOptOutToken(SECRET, 'stepwise', 'nothex')).rejects.toThrow('not a mailbox hash');
  });
  it('makes the link, or null without what it needs', async () => {
    expect(await appOptOutUrl(SECRET, 'stepwise', ANN)).toBe(`${OPTOUT_URL}?t=${await appOptOutToken(SECRET, 'stepwise', ANN)}`);
    expect(await appOptOutUrl(null, 'stepwise', ANN)).toBeNull();
    expect(await appOptOutUrl(SECRET, 'stepwise', null)).toBeNull();
    expect(await appOptOutUrl(SECRET, 'stepwise', 'nothex')).toBeNull();
    expect(await appOptOutUrl(SECRET, 'Bad', ANN)).toBeNull();
  });
});

describe('the per-app undo token (w1)', () => {
  it('verifies for an hour with its app, then expires (naming the app)', async () => {
    const u = await appUndoToken(SECRET, 'stepwise', ANN, NOW);
    const exp = NOW.getTime() / 1000 + UNDO_SECONDS;
    expect(u).toBe(`w1.stepwise.${ANN}.${exp}.${mac(signedText('undo', 'w1', 'app:stepwise', ANN, exp))}`);
    expect(await verifyAppUndoToken(SECRET, u, NOW)).toEqual({ ok: true, emailHash: ANN, app: 'stepwise', scope: 'app:stepwise' });
    expect(await verifyAppUndoToken(SECRET, u, new Date(exp * 1000))).toEqual({ ok: false, reason: 'expired', app: 'stepwise' });
  });
  it('refuses a changed expiry, app or version, a stop token, bad shapes and no secret', async () => {
    const u = await appUndoToken(SECRET, 'stepwise', ANN, NOW);
    const [, , hash, exp, sig] = u.split('.');
    expect(await verifyAppUndoToken(SECRET, `w1.stepwise.${hash}.${Number(exp) + 3600}.${sig}`, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyAppUndoToken(SECRET, `w1.other.${hash}.${exp}.${sig}`, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyAppUndoToken(SECRET, `w2.stepwise.${hash}.${exp}.${sig}`, NOW)).toEqual({ ok: false, reason: 'version' });
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    expect(await verifyAppUndoToken(SECRET, u.slice(0, -1) + alphabet[alphabet.indexOf(u.at(-1)!) ^ 1], NOW)).toEqual({ ok: false, reason: 'format' });
    expect(await verifyAppUndoToken(SECRET, 'w1', NOW)).toEqual({ ok: false, reason: 'format' });
    expect(await verifyAppUndoToken(undefined, u, NOW)).toEqual({ ok: false, reason: 'no secret' });
    await expect(appUndoToken(SECRET, 'x y', ANN, NOW)).rejects.toThrow('not an app slug');
  });
});

/** The opt-out RPCs over a Map (as in signin-optout.test.ts). */
function setup(o: { env?: Partial<OptOutEnv>; fail?: string } = {}) {
  const rows = new Map<string, string>();
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db: Db = {
    rpc: vi.fn(async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
      calls.push([fn, args]);
      if (o.fail === fn) throw new Error(`${fn}: HTTP 500 down`);
      const id = `${String(args.p_email_hash)}|${String(args.p_scope)}`;
      if (fn === 'email_optout_set') {
        rows.set(id, String(args.p_via));
        return { scope: args.p_scope } as T;
      }
      if (fn === 'email_optout_clear') return (rows.delete(id) ? 1 : 0) as T;
      throw new Error(`unexpected rpc ${fn}`);
    }) as Db['rpc'],
  };
  const logs: string[] = [];
  const deps: OptOutDeps = { env: { ...ENV, ...o.env }, fetch: (async () => new Response('')) as unknown as typeof fetch, db, now: () => NOW, log: (m) => logs.push(m) };
  return { deps, rows, calls, logs };
}

const URL_BASE = `https://auth.hintwise.org${OPTOUT_PATH}`;
const get = (t: string) => new Request(`${URL_BASE}?t=${encodeURIComponent(t)}`);
const post = (fields: Record<string, string>, query = '') =>
  new Request(`${URL_BASE}${query}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

describe('email-optout: the per-app pages', () => {
  it('GET with an app token asks about that app only and changes nothing', async () => {
    const s = setup();
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    const res = await handleOptOut(get(t), s.deps);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Turn off emails from stepwise.hintwise.org?</h1>');
    expect(html).toContain('Sign-in links and other HintWise email still come.');
    expect(html).toContain(`<input type="hidden" name="t" value="${t}"><input type="hidden" name="action" value="stop"><button type="submit">Turn off these emails</button>`);
    expect(s.calls).toHaveLength(0);
    expect((await handleOptOut(new Request(`${URL_BASE}?t=${t}`, { method: 'HEAD' }), s.deps)).status).toBe(200);
  });
  it('POST stop sets the app scope only, idempotently, and Done offers an app undo token', async () => {
    const s = setup();
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    for (let i = 0; i < 2; i += 1) {
      const res = await handleOptOut(post({ t, action: 'stop' }), s.deps);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<h1>Done</h1>');
      expect(html).toContain('stepwise.hintwise.org will send no more update emails to this address.');
      expect(html).toContain(`value="${await appUndoToken(SECRET, 'stepwise', ANN, NOW)}"><input type="hidden" name="action" value="undo">`);
    }
    expect([...s.rows.keys()]).toEqual([`${ANN}|app:stepwise`]);
    expect(s.calls[0]).toEqual(['email_optout_set', { p_email_hash: ANN, p_scope: 'app:stepwise', p_via: 'link' }]);
  });
  it('POST undo with the app undo token clears the app scope and offers the app stop again', async () => {
    const s = setup();
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    await handleOptOut(post({ t, action: 'stop' }), s.deps);
    const u = await appUndoToken(SECRET, 'stepwise', ANN, NOW);
    const html = await (await handleOptOut(post({ t: u, action: 'undo' }), s.deps)).text();
    expect(html).toContain('<h1>Emails from stepwise.hintwise.org are on again</h1>');
    expect(html).toContain(`value="${t}"><input type="hidden" name="action" value="stop"><button type="submit" class="quiet">Turn off these emails</button>`);
    expect(s.rows.size).toBe(0);
    expect(s.calls[1]).toEqual(['email_optout_clear', { p_email_hash: ANN, p_scope: 'app:stepwise' }]);
  });
  it('an expired app undo token says so, names the app, and changes nothing', async () => {
    const s = setup();
    const u = await appUndoToken(SECRET, 'stepwise', ANN, NOW);
    s.deps.now = () => new Date(NOW.getTime() + (UNDO_SECONDS + 1) * 1000);
    const res = await handleOptOut(post({ t: u, action: 'undo' }), s.deps);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('<h1>This Undo button has expired</h1>');
    expect(html).toContain('the update emails from stepwise.hintwise.org to this address are still off');
    expect(s.calls).toHaveLength(0);
  });
  it('never lets an app stop token undo, nor an app undo token stop', async () => {
    const s = setup();
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    const u = await appUndoToken(SECRET, 'stepwise', ANN, NOW);
    expect((await handleOptOut(post({ t, action: 'undo' }), s.deps)).status).toBe(400);
    expect((await handleOptOut(post({ t: u, action: 'stop' }), s.deps)).status).toBe(400);
    expect((await handleOptOut(get(u), s.deps)).status).toBe(400);
    expect(s.calls).toHaveLength(0);
  });
  it('a database failure shows the error page and logs the scope and hash prefix, no address', async () => {
    const s = setup({ fail: 'email_optout_set' });
    const res = await handleOptOut(post({ t: await appOptOutToken(SECRET, 'stepwise', ANN), action: 'stop' }), s.deps);
    expect(res.status).toBe(500);
    expect(s.logs.join('\n')).toContain(`stop app:stepwise failed for ${ANN.slice(0, 16)}`);
    expect(s.logs.join('\n')).not.toContain('example.com');
  });
  it('the page escapes everything it shows', () => {
    const { html } = optOutPage('app-confirm', '"><script>', null, 'x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;"');
  });
});

describe('email-optout: RFC 8058 one-click', () => {
  it('POST List-Unsubscribe=One-Click to the app link stops that app at once', async () => {
    const s = setup();
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    const res = await handleOptOut(post({ 'List-Unsubscribe': 'One-Click' }, `?t=${t}`), s.deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>Done</h1>');
    expect([...s.rows.keys()]).toEqual([`${ANN}|app:stepwise`]);
  });
  it('accepts the multipart/form-data spelling', async () => {
    const s = setup();
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    const form = new FormData();
    form.append('List-Unsubscribe', 'One-Click');
    const res = await handleOptOut(new Request(`${URL_BASE}?t=${t}`, { method: 'POST', body: form }), s.deps);
    expect(res.status).toBe(200);
    expect(s.rows.size).toBe(1);
  });
  it('refuses one-click with a v1 token, an undo token, no token or another value, and changes nothing', async () => {
    const s = setup();
    const v1 = await optOutToken(SECRET, ANN);
    const w1 = await appUndoToken(SECRET, 'stepwise', ANN, NOW);
    for (const q of [`?t=${v1}`, `?t=${w1}`, '']) {
      expect((await handleOptOut(post({ 'List-Unsubscribe': 'One-Click' }, q), s.deps)).status, q).toBe(400);
    }
    const t = await appOptOutToken(SECRET, 'stepwise', ANN);
    expect((await handleOptOut(post({ 'List-Unsubscribe': 'Yes' }, `?t=${t}`), s.deps)).status).toBe(400);
    expect(s.calls).toHaveLength(0);
  });
  it('takes multipart only for one-click: a multipart v1 form is refused as before', async () => {
    const s = setup();
    const form = new FormData();
    form.append('t', await optOutToken(SECRET, ANN));
    form.append('action', 'stop');
    expect((await handleOptOut(new Request(URL_BASE, { method: 'POST', body: form }), s.deps)).status).toBe(400);
    const junk = new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'not multipart' });
    expect((await handleOptOut(junk, s.deps)).status).toBe(400);
    expect(s.calls).toHaveLength(0);
  });
  it('the v1 pages are unchanged by the app tokens', async () => {
    const s = setup();
    const t = await optOutToken(SECRET, ANN);
    const html = await (await handleOptOut(post({ t, action: 'stop' }), s.deps)).text();
    expect(html).toContain('HintWise will send no more email to this address, sign-in links included.');
    expect(s.calls[0]).toEqual(['email_optout_set', { p_email_hash: ANN, p_scope: 'all', p_via: 'link' }]);
  });
});
