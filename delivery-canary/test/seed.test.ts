import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { analyseEmail } from '../src/core/email';
import { sampleEmail } from '../src/core/sample';
import { handleApi, parseSeedBody, resetReachCache, type ApiDeps, type SeedDeps } from '../src/server/api';
import { fetchItems, ImapClient, ImapError, internalDate, listEntries, parseStatus, Quoted, quote, ResponseSplitter, searchIds, str, tokenize } from '../src/server/imap';
import { liveDeps } from '../src/server/netlify';
import { addressTag, keyFrom, open, seal, seedAad } from '../src/server/secretbox';
import { cleanPassword, findMailboxes, greetingOnly, gmailSearch, loginError, runSeedCheck, SeedError, seedQueryProblem, type SeedFound, type SeedQuery } from '../src/server/seed';
import { recordSeedCheck, saveSeed, seedSecret, type SeedSave } from '../src/server/supabase-rest';
import { fakeGmail, type FakeMessage } from './gmail-fake';

const RAW = sampleEmail('https://files.juniperstitch.example/d/abc123/pattern.pdf');
const later = () => Date.now() + 5000;
const query: SeedQuery = { address: 'canary.shop@gmail.com', password: 'abcdabcdabcdabcd', sender: 'orders@juniperstitch.example', subject: '', days: 14 };
const msg = (over: Partial<FakeMessage> = {}): FakeMessage => ({ uid: 512, box: 'all', date: '14-Nov-2026 09:12:40 +0000', labels: '("\\\\Inbox" "Shop tests")', raw: RAW, ...over });

describe('IMAP response reading', () => {
  it('splits a stream into responses, across chunks and literals', () => {
    const s = new ResponseSplitter();
    expect(s.push(Buffer.from('* OK hel'))).toEqual([]);
    const a = s.push(Buffer.from('lo\r\n* 1 FETCH (BODY[]<0> {5}\r\nab'));
    expect(a).toHaveLength(1);
    expect(a[0].parts).toEqual(['* OK hello']);
    const b = s.push(Buffer.from('c\r\n UID 4)\r\nD1 OK done\r\n'));
    expect(b).toHaveLength(2);
    expect(b[0].literals[0].toString()).toBe('abc\r\n');
    expect(b[0].parts).toEqual(['* 1 FETCH (BODY[]<0> {5}', ' UID 4)']);
    expect(b[1].parts).toEqual(['D1 OK done']);
  });
  it('refuses more than it reads', () => {
    expect(() => new ResponseSplitter(10).push(Buffer.from('x'.repeat(11)))).toThrow(ImapError);
    expect(() => new ResponseSplitter(100).push(Buffer.from('* 1 FETCH (BODY[] {999}\r\n'))).toThrow(/more than/);
  });
  it('tokenizes lists, quoted strings, NIL, literals and bracketed atoms', () => {
    const t = tokenize({ parts: ['* 3 FETCH (X-GM-LABELS ("\\\\Inbox" \\Important "Say \\"hi\\"") UID 7 FLAGS () ENVELOPE NIL BODY[]<0> {3}', ')'], literals: [Buffer.from('abc')] });
    expect(t[0]).toBe('*');
    const items = fetchItems(t.slice(1));
    expect((items.get('X-GM-LABELS') as unknown[]).map((x) => str(x as never))).toEqual(['\\Inbox', '\\Important', 'Say "hi"']);
    expect(str(items.get('UID'))).toBe('7');
    expect(items.get('FLAGS')).toEqual([]);
    expect(items.get('ENVELOPE')).toBeNull();
    expect((items.get('BODY[]<0>') as Buffer).toString()).toBe('abc');
    expect(tokenize({ parts: ['"NIL"'], literals: [] })[0]).toBeInstanceOf(Quoted);
    expect(tokenize({ parts: ['* LIST () "/" "[Gmail]/All Mail" x)'], literals: [] })[4]).toBeInstanceOf(Quoted);
    expect(tokenize({ parts: ['A [B C] D'], literals: [] })).toEqual(['A', '[B C]', 'D']);
    expect(tokenize({ parts: ['"Ã©tÃ©"'], literals: [] }).map((x) => str(x))).toEqual(['été']);
    expect(tokenize({ parts: ['x {2}'], literals: [] })[1]).toEqual(Buffer.alloc(0));
  });
  it('reads status lines, search results, list entries and dates', () => {
    expect(parseStatus('NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)')).toEqual({ status: 'NO', code: 'AUTHENTICATIONFAILED', text: 'Invalid credentials (Failure)' });
    expect(parseStatus('ok fine')).toEqual({ status: 'OK', code: '', text: 'fine' });
    expect(() => parseStatus('MAYBE')).toThrow(ImapError);
    expect(searchIds([['SEARCH', '3', '9', 'x'], ['EXISTS']])).toEqual([3, 9]);
    expect(listEntries([['LIST', ['\\All'], new Quoted('/'), new Quoted('[Gmail]/All Mail')], ['LIST', 'x'], ['OK']])).toEqual([{ flags: ['\\All'], name: '[Gmail]/All Mail' }]);
    expect(fetchItems(['3', 'EXPUNGE'])).toEqual(new Map());
    expect(internalDate('14-Nov-2026 10:02:03 +0100')).toBe('2026-11-14T09:02:03.000Z');
    expect(internalDate(' 4-Nov-2026 10:02:03 -0730')).toBe('2026-11-04T17:32:03.000Z');
    expect(internalDate('14-Xyz-2026 10:02:03 +0000')).toBe('');
    expect(internalDate('yesterday')).toBe('');
    expect(str(undefined)).toBe('');
    expect(str(['a'])).toBe('');
  });
  it('quotes values and refuses line breaks', () => {
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(() => quote('a\r\nD2 LOGOUT')).toThrow(ImapError);
  });
});

/** A socket that answers each command with the given text (TAG replaced), or stays silent. */
function scripted(greeting: string, replies: Array<string | null>, close = false): Duplex {
  let i = 0;
  const s: Duplex = new Duplex({
    read() {},
    write(chunk: Buffer, _e, cb) {
      const tag = chunk.toString().split(' ')[0];
      const r = replies[i++];
      if (r) setImmediate(() => s.push(r.replace(/TAG/g, tag)));
      if (close) setImmediate(() => s.destroy());
      cb();
    },
  });
  setImmediate(() => s.push(greeting));
  return s;
}

describe('ImapClient', () => {
  it('refuses a BYE greeting', async () => {
    const c = new ImapClient(scripted('* BYE too busy\r\n', []), { deadline: later() });
    await expect(c.greeting()).rejects.toThrow(/refused the connection/);
  });
  it('turns NO and BAD into errors with their kind', async () => {
    const c = new ImapClient(scripted('* OK hi\r\n', ['TAG NO [ALERT] nope\r\n', 'TAG BAD what\r\n', '+ go on\r\nTAG OK fine\r\n', 'junk\r\n']), { deadline: later() });
    await c.greeting();
    await expect(c.command('X')).rejects.toMatchObject({ kind: 'no', response: { code: 'ALERT', text: 'nope' } });
    await expect(c.command('Y')).rejects.toMatchObject({ kind: 'bad' });
    expect((await c.command('Z')).status).toBe('OK');
    await expect(c.command('W')).rejects.toMatchObject({ kind: 'protocol' });
  });
  it('times out at the deadline', async () => {
    let t = 0;
    const c = new ImapClient(scripted('* OK hi\r\n', [null]), { deadline: 50, now: () => t });
    await c.greeting();
    const p = c.command('NOOP');
    t = 100;
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
    const silent = new ImapClient(scripted('* OK hi\r\n', [null]), { deadline: Date.now() + 30 });
    await silent.greeting();
    await expect(silent.command('NOOP')).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('fails when the server closes, after BYE or not', async () => {
    const c = new ImapClient(scripted('* OK hi\r\n', ['* BYE going away\r\n'], true), { deadline: later() });
    await c.greeting();
    await expect(c.command('NOOP')).rejects.toMatchObject({ kind: 'closed' });
    await expect(c.command('NOOP')).rejects.toMatchObject({ kind: 'closed' });
    await c.logout(); // never throws
    const d = new ImapClient(scripted('* OK hi\r\n', [null], true), { deadline: later() });
    await d.greeting();
    await expect(d.command('NOOP')).rejects.toThrow(/closed the connection/);
  });
  it('reports a socket error and an oversized reply as closed', async () => {
    const s = scripted('* OK hi\r\n', [null]);
    const c = new ImapClient(s, { deadline: later() });
    await c.greeting();
    const p = c.command('NOOP');
    s.emit('error', new Error('reset'));
    await expect(p).rejects.toThrow(/Connection error: reset/);
    const big = scripted('* OK hi\r\n', [`* 1 FETCH (BODY[] {${20 * 1024 * 1024}}\r\n`]);
    const b = new ImapClient(big, { deadline: later() });
    await b.greeting();
    await expect(b.command('FETCH')).rejects.toThrow(/more than this check reads/);
  });
});

describe('seed query rules', () => {
  it('checks each field in plain words', () => {
    expect(seedQueryProblem(query)).toBe('');
    expect(seedQueryProblem({ ...query, sender: 'juniperstitch.example', subject: 'Your pattern is ready!' })).toBe('');
    expect(seedQueryProblem({ ...query, address: 'nope' })).toMatch(/seed Gmail address/);
    expect(seedQueryProblem({ ...query, sender: 'from:x OR y' })).toMatch(/download emails come from/);
    expect(seedQueryProblem({ ...query, sender: 'localhost' })).toMatch(/download emails come from/);
    expect(seedQueryProblem({ ...query, subject: 'say "hi"' })).toMatch(/Subject words/);
    expect(seedQueryProblem({ ...query, password: 'short' })).toMatch(/app password/);
    expect(seedQueryProblem({ ...query, password: 'abcd\nabcdabcdabcd' })).toMatch(/app password/);
    expect(seedQueryProblem({ ...query, days: 0 })).toMatch(/between 1 and 60/);
    expect(seedQueryProblem({ ...query, days: 1.5 })).toMatch(/between 1 and 60/);
  });
  it('cleans app passwords and builds the Gmail search', () => {
    expect(cleanPassword(' abcd efgh ijkl mnop ')).toBe('abcdefghijklmnop');
    expect(gmailSearch(query)).toBe('from:orders@juniperstitch.example newer_than:14d');
    expect(gmailSearch({ ...query, subject: '  Your  download ', days: 3 })).toBe('from:orders@juniperstitch.example newer_than:3d subject:(Your download)');
  });
  it('maps refused sign-ins to what to do', () => {
    const no = (code: string, text: string) => new ImapError(text, 'no', { status: 'NO', code, text });
    expect(loginError(no('ALERT', 'Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)')).code).toBe('needs-app-password');
    expect(loginError(no('ALERT', 'Please log in via your web browser: https://support.google.com/mail/accounts/answer/78754 (Failure)')).code).toBe('web-login');
    expect(loginError(no('ALERT', 'Your account is not enabled for IMAP use. (Failure)')).code).toBe('imap-off');
    expect(loginError(no('AUTHENTICATIONFAILED', 'Invalid credentials (Failure)')).code).toBe('login-failed');
    expect(loginError(new ImapError('x', 'no')).code).toBe('login-failed');
  });
  it('finds All Mail and Spam by flag, then by name', () => {
    expect(findMailboxes([{ flags: ['\\All'], name: '[Google Mail]/Alle Nachrichten' }, { flags: ['\\Junk'], name: '[Google Mail]/Spam' }])).toEqual({ all: '[Google Mail]/Alle Nachrichten', spam: '[Google Mail]/Spam' });
    expect(findMailboxes([{ flags: [], name: '[Google Mail]/All Mail' }, { flags: [], name: '[Gmail]/Spam' }])).toEqual({ all: '[Google Mail]/All Mail', spam: '[Gmail]/Spam' });
    expect(findMailboxes([{ flags: [], name: 'INBOX' }])).toEqual({ all: '', spam: '' });
  });
});

describe('runSeedCheck against a recorded Gmail session', () => {
  it('finds a Primary inbox email, read-only, and logs out', async () => {
    const g = fakeGmail({ messages: [msg({ uid: 500, date: '13-Nov-2026 09:00:00 +0000' }), msg()] });
    const r = (await runSeedCheck(g.socket, query, later())) as SeedFound;
    expect(r).toMatchObject({ found: true, where: 'primary', placement: 'inbox', receivedAt: '2026-11-14T09:12:40.000Z', labels: ['Shop tests'], truncated: false });
    expect(Buffer.from(r.raw, 'base64').toString('utf8')).toBe(RAW);
    expect(g.sent[0]).toBe('LOGIN "canary.shop@gmail.com" "abcdabcdabcdabcd"');
    expect(g.sent).toContain('UID SEARCH X-GM-RAW "from:orders@juniperstitch.example newer_than:14d"');
    expect(g.sent.some((c) => c.startsWith('SELECT') || c.includes('STORE') || / BODY\[\]/.test(c))).toBe(false);
    expect(g.sent.at(-1)).toBe('LOGOUT');
    const a = await analyseEmail(Buffer.from(r.raw, 'base64').buffer.slice(0) as ArrayBuffer);
    expect(a.from.address).toBe('hello@juniperstitch.example');
  });
  it('reads the Promotions tab and the other categories', async () => {
    const promo = (await runSeedCheck(fakeGmail({ messages: [msg({ categories: ['promotions'] })] }).socket, query, later())) as SeedFound;
    expect([promo.where, promo.placement]).toEqual(['promotions', 'promotions']);
    const upd = (await runSeedCheck(fakeGmail({ messages: [msg({ categories: ['updates'], labels: '(\\Inbox \\Important)' })] }).socket, query, later())) as SeedFound;
    expect([upd.where, upd.placement, upd.labels]).toEqual(['updates', 'other', []]);
  });
  it('reads an archived email (no Inbox label) and a Spam copy', async () => {
    const arch = (await runSeedCheck(fakeGmail({ messages: [msg({ labels: '("Shop tests")' })] }).socket, query, later())) as SeedFound;
    expect(arch.where).toBe('archived');
    const g = fakeGmail({ messages: [msg({ date: '13-Nov-2026 09:00:00 +0000' }), msg({ uid: 77, box: 'spam', labels: '()' })], chunk: 97 });
    const spam = (await runSeedCheck(g.socket, query, later())) as SeedFound;
    expect([spam.where, spam.placement]).toEqual(['spam', 'spam']);
    expect(g.sent.filter((c) => c.startsWith('EXAMINE'))).toEqual(['EXAMINE "[Gmail]/Spam"', 'EXAMINE "[Gmail]/All Mail"', 'EXAMINE "[Gmail]/Spam"']);
    const older = (await runSeedCheck(fakeGmail({ messages: [msg(), msg({ uid: 77, box: 'spam', date: '01-Nov-2026 09:00:00 +0000' })] }).socket, query, later())) as SeedFound;
    expect(older.where).toBe('primary');
  });
  it('says when nothing matches, and marks a message read only in part', async () => {
    expect(await runSeedCheck(fakeGmail().socket, query, later())).toEqual({ found: false });
    const big = (await runSeedCheck(fakeGmail({ messages: [msg({ size: 9_000_000 })] }).socket, query, later())) as SeedFound;
    expect(big.truncated).toBe(true);
    expect(big.size).toBe(9_000_000);
  });
  it('works without a Spam folder', async () => {
    const list = ['* LIST (\\All \\HasNoChildren) "/" "[Gmail]/All Mail"'];
    const r = (await runSeedCheck(fakeGmail({ list, messages: [msg()] }).socket, query, later())) as SeedFound;
    expect(r.where).toBe('primary');
  });
  it('turns a refused sign-in into a plain-words error', async () => {
    const g = fakeGmail({ login: 'TAG NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n' });
    await expect(runSeedCheck(g.socket, query, later())).rejects.toMatchObject({ code: 'login-failed', message: expect.stringMatching(/did not accept/) });
    const h = fakeGmail({ login: 'TAG NO [ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)\r\n' });
    await expect(runSeedCheck(h.socket, query, later())).rejects.toMatchObject({ code: 'needs-app-password' });
  });
  it('refuses a mailbox that is not Gmail, or a folder it cannot open', async () => {
    await expect(runSeedCheck(fakeGmail({ list: ['* LIST (\\HasNoChildren) "/" "INBOX"'] }).socket, query, later())).rejects.toMatchObject({ code: 'mailbox' });
    const g = fakeGmail({ override: (c) => (c.startsWith('EXAMINE') ? 'TAG NO [NONEXISTENT] Unknown Mailbox (Failure)\r\n' : undefined) });
    await expect(runSeedCheck(g.socket, query, later())).rejects.toMatchObject({ code: 'mailbox', message: expect.stringMatching(/Spam/) });
  });
  it('maps timeouts, closed connections and odd answers', async () => {
    const silent = fakeGmail({ override: (c) => (c.startsWith('LIST') ? null : undefined) });
    await expect(runSeedCheck(silent.socket, query, Date.now() + 40)).rejects.toMatchObject({ code: 'timeout' });
    const bye = fakeGmail({ override: (c) => (c.startsWith('LIST') ? '* BYE System error\r\n' : undefined) });
    setTimeout(() => bye.socket.destroy(), 30);
    await expect(runSeedCheck(bye.socket, query, later())).rejects.toMatchObject({ code: 'unreachable' });
    const bad = fakeGmail({ login: 'TAG BAD Command syntax error\r\n' });
    await expect(runSeedCheck(bad.socket, query, later())).rejects.toMatchObject({ code: 'protocol' });
    const nobody = fakeGmail({ messages: [msg()], override: (c) => (/BODY\.PEEK/.test(c) ? '* 3 FETCH (UID 512 INTERNALDATE "14-Nov-2026 09:12:40 +0000")\r\nTAG OK Success\r\n' : undefined) });
    await expect(runSeedCheck(nobody.socket, query, later())).rejects.toMatchObject({ code: 'protocol', message: expect.stringMatching(/did not send it/) });
    const generic = fakeGmail({ override: (c) => (c.startsWith('LIST') ? 'TAG NO [UNAVAILABLE] Temporary System Error\r\n' : undefined) });
    await expect(runSeedCheck(generic.socket, query, later())).rejects.toBeInstanceOf(SeedError);
  });
  it('uses the search arrival time when the body fetch has no date', async () => {
    const g = fakeGmail({
      messages: [msg()],
      override: (c) => (/BODY\.PEEK/.test(c) ? `* 3 FETCH (UID 512 X-GM-LABELS (\\Inbox) BODY[]<0> {5}\r\nhello)\r\nTAG OK Success\r\n` : undefined),
    });
    const r = (await runSeedCheck(g.socket, query, later())) as SeedFound;
    expect(r.receivedAt).toBe('2026-11-14T09:12:40.000Z');
    expect(r.size).toBe(5);
  });
});

describe('secretbox', () => {
  const key = keyFrom(Buffer.alloc(32, 7).toString('base64'))!;
  it('takes a base64 key or hashes a long text; refuses short or missing ones', () => {
    expect(key).toEqual(Buffer.alloc(32, 7));
    expect(keyFrom('x'.repeat(40))).toHaveLength(32);
    expect(keyFrom(`${'A'.repeat(43)}=`)).toHaveLength(32);
    expect(keyFrom('short')).toBeNull();
    expect(keyFrom(undefined)).toBeNull();
  });
  it('seals and opens only with the same key and binding', () => {
    const aad = seedAad('u1', 's1', 'Canary@Gmail.com');
    expect(aad).toBe(seedAad('u1', 's1', 'canary@gmail.com'));
    const sealed = seal(key, 'abcdabcdabcdabcd', aad);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('abcd');
    expect(open(key, sealed, aad)).toBe('abcdabcdabcdabcd');
    expect(open(key, sealed, seedAad('u2', 's1', 'canary@gmail.com'))).toBeNull();
    expect(open(keyFrom('y'.repeat(40))!, sealed, aad)).toBeNull();
    expect(open(key, `${sealed.slice(0, -2)}AA`, aad)).toBeNull();
    expect(open(key, 'v2.nope', aad)).toBeNull();
    expect(seal(key, 'abcdabcdabcdabcd', aad)).not.toBe(sealed);
  });
  it('tags an address without keeping it', () => {
    expect(addressTag('A@gmail.com')).toBe(addressTag('a@gmail.com'));
    expect(addressTag('a@gmail.com')).toMatch(/^[0-9a-f]{64}$/);
  });
});

const SHOP = '6f1c1d6e-1b7a-4a39-9a2e-0d4b4c1b2a10';
const auth = { authorization: 'Bearer good-token-0123456789abcdef' };
const KEY = Buffer.alloc(32, 9);

function seedDeps(over: Partial<SeedDeps> = {}): SeedDeps & { saves: SeedSave[]; checked: SeedQuery[]; tags: string[] } {
  const saves: SeedSave[] = [];
  const checked: SeedQuery[] = [];
  const tags: string[] = [];
  return {
    saves,
    checked,
    tags,
    key: KEY,
    record: async (_t, tag) => {
      tags.push(tag);
      return 'ok';
    },
    secret: async () => null,
    save: async (_t, s) => {
      saves.push(s);
      return s.secretMode === 'set';
    },
    reachable: async () => true,
    check: async (q) => {
      checked.push(q);
      return { found: true, where: 'promotions', placement: 'promotions', receivedAt: '2026-11-14T09:12:40.000Z', labels: [], size: 5, truncated: false, raw: 'aGVsbG8=' };
    },
    ...over,
  };
}

function api(seed: SeedDeps, verify: ApiDeps['verifyUser'] = async (t) => (t.startsWith('good') ? 'user-1' : null)): ApiDeps {
  return { verifyUser: verify, record: async () => 'ok', fetchFile: async () => { throw new Error('unused'); }, seed };
}

const body = (over: Record<string, unknown> = {}) => JSON.stringify({ shopId: SHOP, address: 'Canary.Shop@gmail.com', sender: 'orders@juniperstitch.example', password: 'abcd efgh ijkl mnop', remember: true, ...over });
const post = (d: ApiDeps, b: string | null = body(), h: Record<string, string> = auth) => handleApi('POST', '/api/seed-check', b, h, d);

describe('POST /api/seed-check', () => {
  it('reads and checks the body', () => {
    expect(parseSeedBody('nope')).toMatch(/Send JSON/);
    expect(parseSeedBody('[1]')).toMatch(/Send JSON/);
    expect(parseSeedBody(JSON.stringify({ shopId: 'x' }))).toMatch(/Save the shop first/);
    expect(parseSeedBody(body({ sender: 'x' }))).toMatch(/download emails come from/);
    expect(parseSeedBody(body({ days: '3' }))).toMatch(/between 1 and 60/);
    expect(parseSeedBody(body({ password: undefined, subject: ' Your   pattern ', days: 7 }))).toEqual({ shopId: SHOP, address: 'canary.shop@gmail.com', sender: 'orders@juniperstitch.example', subject: 'Your pattern', password: '', remember: true, days: 7 });
  });
  it('wants POST, a token, a good body and a live session', async () => {
    const s = seedDeps();
    expect((await handleApi('GET', '/api/seed-check', null, auth, api(s))).status).toBe(405);
    expect((await post(api(s), body(), {})).status).toBe(401);
    expect((await post(api(s), 'x')).status).toBe(400);
    expect((await post(api(s), body(), { authorization: 'Bearer bad-token-0123456789abcdef' })).status).toBe(401);
    expect((await post(api(s, async () => { throw new Error('down'); }))).status).toBe(503);
    expect(s.checked).toEqual([]);
  });
  it('checks with a typed password and keeps it sealed when asked', async () => {
    const s = seedDeps();
    const r = await post(api(s));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ found: true, where: 'promotions', outcome: 'found', kept: true, saved: true, raw: 'aGVsbG8=' });
    expect(s.checked[0]).toEqual({ address: 'canary.shop@gmail.com', password: 'abcdefghijklmnop', sender: 'orders@juniperstitch.example', subject: '', days: 14 });
    expect(s.tags).toEqual([addressTag('canary.shop@gmail.com')]);
    const saved = s.saves[0];
    expect(saved).toMatchObject({ shopId: SHOP, address: 'canary.shop@gmail.com', secretMode: 'set', outcome: 'found' });
    expect(open(KEY, saved.secret!, seedAad('user-1', SHOP, 'canary.shop@gmail.com'))).toBe('abcdefghijklmnop');
    expect(JSON.stringify(r.body)).not.toContain('abcdefghijklmnop');
  });
  it('clears a kept password when not asked to keep it, or without a key', async () => {
    const s = seedDeps();
    await post(api(s), body({ remember: false }));
    expect(s.saves[0]).toMatchObject({ secretMode: 'clear', secret: null });
    const n = seedDeps({ key: null });
    await post(api(n));
    expect(n.saves[0].secretMode).toBe('clear');
  });
  it('uses the kept password when none is typed', async () => {
    const sealed = seal(KEY, 'keptkeptkeptkept', seedAad('user-1', SHOP, 'canary.shop@gmail.com'));
    const s = seedDeps({ secret: async () => sealed });
    const r = await post(api(s), body({ password: '' }));
    expect(r.status).toBe(200);
    expect(s.checked[0].password).toBe('keptkeptkeptkept');
    expect(s.saves[0]).toMatchObject({ secretMode: 'keep', secret: null });
  });
  it('asks for the password when none can be used', async () => {
    expect((await post(api(seedDeps({ key: null })), body({ password: '' }))).body).toMatchObject({ outcome: 'no-password', error: expect.stringMatching(/does not keep/) });
    expect((await post(api(seedDeps()), body({ password: '' }))).body).toMatchObject({ error: expect.stringMatching(/No app password is kept/) });
    const other = seal(KEY, 'keptkeptkeptkept', seedAad('user-1', SHOP, 'old@gmail.com'));
    const r = await post(api(seedDeps({ secret: async () => other })), body({ password: '' }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.stringMatching(/another address/) });
  });
  it('stops at the hourly limit before signing in', async () => {
    const s = seedDeps({ record: async () => 'limited' });
    const r = await post(api(s));
    expect(r.status).toBe(429);
    expect(s.checked).toEqual([]);
  });
  it('reports a refused sign-in (422) without keeping the typed password', async () => {
    const s = seedDeps({ check: async () => { throw new SeedError('login-failed', 'Gmail did not accept this.'); } });
    const r = await post(api(s));
    expect(r).toEqual({ status: 422, body: { error: 'Gmail did not accept this.', outcome: 'login-failed', kept: false, saved: true } });
    expect(s.saves[0]).toMatchObject({ secretMode: 'keep', outcome: 'login-failed' });
  });
  it('reports Gmail trouble (502), unexpected errors, not-found and a failed save', async () => {
    expect((await post(api(seedDeps({ check: async () => { throw new SeedError('timeout', 'slow'); } })))).status).toBe(502);
    const odd = await post(api(seedDeps({ check: async () => { throw new Error('boom'); } })));
    expect(odd).toMatchObject({ status: 502, body: { outcome: 'protocol' } });
    const nf = seedDeps({ check: async () => ({ found: false }) });
    const r = await post(api(nf));
    expect(r).toEqual({ status: 200, body: { found: false, outcome: 'not-found', kept: true, saved: true } });
    const unsaved = await post(api(seedDeps({ save: async () => { throw new Error('403'); } })));
    expect(unsaved.body).toMatchObject({ found: true, saved: false, kept: false });
  });
  it('probes Gmail reachability publicly, once a minute', async () => {
    resetReachCache();
    let calls = 0;
    const d = api(seedDeps({ reachable: async () => (calls++, false) }));
    expect((await handleApi('GET', '/api/seed-reach', null, {}, d)).body).toEqual({ gmailImap: false });
    expect((await handleApi('GET', '/api/seed-reach', null, {}, d)).body).toEqual({ gmailImap: false });
    expect(calls).toBe(1);
    resetReachCache();
    expect(await greetingOnly(fakeGmail().socket, later())).toBe(true);
    expect(await greetingOnly(fakeGmail({ greeting: '* BYE no\r\n' }).socket, later())).toBe(false);
  });
  it('tells the page whether passwords can be kept', async () => {
    expect((await handleApi('GET', '/api/health', null, {}, api(seedDeps()))).body).toMatchObject({ seedKeep: true });
  });
});

describe('seed REST calls', () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (status: number, json: unknown) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(json), { status });
    }) as unknown as typeof fetch;
  const cfg = (status: number, json: unknown = null) => ({ url: 'https://auth.example/', anonKey: 'anon', fetchImpl: fake(status, json) });
  const save: SeedSave = { shopId: SHOP, address: 'a@gmail.com', sender: 'shop.example', subject: '', secretMode: 'keep', secret: null, outcome: 'found' };
  it('records a seed check, with 429 as the limit', async () => {
    expect(await recordSeedCheck(cfg(201), 't', 'ab')).toBe('ok');
    expect(calls.at(-1)!.url).toBe('https://auth.example/rest/v1/seed_checks');
    expect((calls.at(-1)!.init.headers as Record<string, string>)['content-profile']).toBe('app_delivery_canary');
    expect(await recordSeedCheck(cfg(429), 't', 'ab')).toBe('limited');
    await expect(recordSeedCheck(cfg(500), 't', 'ab')).rejects.toThrow(/seed_checks 500/);
  });
  it('reads the sealed secret', async () => {
    expect(await seedSecret(cfg(200, 'v1.x.y'), 't', SHOP)).toBe('v1.x.y');
    expect(calls.at(-1)!.url).toBe('https://auth.example/rest/v1/rpc/seed_inbox_secret');
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ p_shop: SHOP });
    expect(await seedSecret(cfg(200, null), 't', SHOP)).toBeNull();
    await expect(seedSecret(cfg(403), 't', SHOP)).rejects.toThrow(/403/);
  });
  it('saves the settings', async () => {
    expect(await saveSeed(cfg(200, true), 't', save)).toBe(true);
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ p_shop: SHOP, p_address: 'a@gmail.com', p_sender: 'shop.example', p_subject: '', p_secret_mode: 'keep', p_secret: null, p_outcome: 'found' });
    expect(await saveSeed(cfg(200, false), 't', save)).toBe(false);
    await expect(saveSeed(cfg(400), 't', save)).rejects.toThrow(/seed_inbox_save 400/);
  });
  it('wires the live deps with the key from the environment', async () => {
    const d = liveDeps(cfg(200, 'v1.a.b'), Buffer.alloc(32, 1).toString('base64'));
    expect(d.seed.key).toEqual(Buffer.alloc(32, 1));
    expect(await d.seed.secret('t', SHOP)).toBe('v1.a.b');
    expect(await d.seed.record('t', 'ab')).toBe('ok');
    expect(await liveDeps(cfg(200, true), undefined).seed.save('t', save)).toBe(true);
    expect(liveDeps(cfg(200), undefined).seed.key).toBeNull();
  });
});
