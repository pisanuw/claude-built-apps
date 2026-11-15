import { memoryShopDeps } from './shopify-fake';
import { describe, expect, it } from 'vitest';
import { sampleEmail } from '../src/core/sample';
import { handleApi, parseSeedBody, type ApiDeps, type SeedDeps } from '../src/server/api';
import { AFTER_SLACK_S, afterSeconds, gmailSearch, runSeedCheck, type SeedFound, type SeedQuery } from '../src/server/seed';
import { fakeGmail, type FakeMessage } from './gmail-fake';

/** Only an email that arrived after the canary order counts (milestone 4). */
const RAW = sampleEmail('https://files.juniperstitch.example/d/abc123/pattern.pdf');
const later = () => Date.now() + 5000;
const PLACED = '2026-11-15T10:00:05.000Z';
const PLACED_S = Date.parse(PLACED) / 1000;
const query: SeedQuery = { address: 'canary.shop@gmail.com', password: 'abcdabcdabcdabcd', sender: 'orders@juniperstitch.example', subject: '', days: 1, after: PLACED };
const msg = (over: Partial<FakeMessage> = {}): FakeMessage => ({ uid: 600, box: 'all', date: '15-Nov-2026 10:00:40 +0000', labels: '("\\\\Inbox")', raw: RAW, ...over });

describe('afterSeconds and the Gmail search', () => {
  it('reads the time as Unix seconds less a minute of slack', () => {
    expect(AFTER_SLACK_S).toBe(60);
    expect(afterSeconds(PLACED)).toBe(PLACED_S - 60);
    expect(afterSeconds('2026-11-15T10:00:05.999Z')).toBe(PLACED_S - 60);
    expect(afterSeconds('1970-01-01T00:00:10Z')).toBe(0);
    expect(afterSeconds('')).toBeNull();
    expect(afterSeconds(undefined)).toBeNull();
    expect(afterSeconds('not a time')).toBeNull();
  });
  it('adds after: to the search only when there is a time', () => {
    expect(gmailSearch(query)).toBe(`from:orders@juniperstitch.example newer_than:1d after:${PLACED_S - 60}`);
    expect(gmailSearch({ ...query, subject: 'Your download' })).toBe(`from:orders@juniperstitch.example newer_than:1d after:${PLACED_S - 60} subject:(Your download)`);
    expect(gmailSearch({ ...query, after: '' })).toBe('from:orders@juniperstitch.example newer_than:1d');
    expect(gmailSearch({ ...query, after: undefined })).toBe('from:orders@juniperstitch.example newer_than:1d');
  });
});

describe('runSeedCheck with a canary time', () => {
  it('does not take an email from before the order for the canary', async () => {
    const g = fakeGmail({ messages: [msg({ uid: 590, date: '15-Nov-2026 09:40:00 +0000' })] });
    expect(await runSeedCheck(g.socket, query, later())).toEqual({ found: false });
    expect(g.sent).toContain(`UID SEARCH X-GM-RAW "from:orders@juniperstitch.example newer_than:1d after:${PLACED_S - 60}"`);
    expect(g.sent.some((c) => c.includes('BODY.PEEK'))).toBe(false);
    // An older Spam copy does not count either.
    const spam = fakeGmail({ messages: [msg({ uid: 70, box: 'spam', date: '14-Nov-2026 22:00:00 +0000', labels: '()' })] });
    expect(await runSeedCheck(spam.socket, query, later())).toEqual({ found: false });
  });
  it('finds the email that arrived after the order, within the clock slack too', async () => {
    const r = (await runSeedCheck(fakeGmail({ messages: [msg()] }).socket, query, later())) as SeedFound;
    expect(r).toMatchObject({ found: true, where: 'primary', receivedAt: '2026-11-15T10:00:40.000Z' });
    const slack = (await runSeedCheck(fakeGmail({ messages: [msg({ date: '15-Nov-2026 09:59:30 +0000' })] }).socket, query, later())) as SeedFound;
    expect(slack.found).toBe(true);
    const edge = (await runSeedCheck(fakeGmail({ messages: [msg({ date: '15-Nov-2026 09:59:05 +0000' })] }).socket, query, later())) as SeedFound;
    expect(edge.found).toBe(true);
    expect(await runSeedCheck(fakeGmail({ messages: [msg({ date: '15-Nov-2026 09:59:04 +0000' })] }).socket, query, later())).toEqual({ found: false });
  });
  it('keeps the newer copy when an older one is in the other folder', async () => {
    const g = fakeGmail({ messages: [msg({ uid: 70, box: 'spam', date: '15-Nov-2026 09:00:00 +0000', labels: '()' }), msg()] });
    const r = (await runSeedCheck(g.socket, query, later())) as SeedFound;
    expect(r.where).toBe('primary');
    const s = fakeGmail({ messages: [msg({ uid: 70, box: 'spam', labels: '()' }), msg({ date: '15-Nov-2026 08:00:00 +0000' })] });
    expect(((await runSeedCheck(s.socket, query, later())) as SeedFound).where).toBe('spam');
  });
  it('keeps a match whose arrival time Gmail did not give', async () => {
    const g = fakeGmail({ messages: [msg()], override: (c) => (/^UID FETCH \d+ \(UID INTERNALDATE\)$/.test(c) ? 'TAG OK Success\r\n' : undefined) });
    const r = (await runSeedCheck(g.socket, query, later())) as SeedFound;
    expect(r).toMatchObject({ found: true, receivedAt: '2026-11-15T10:00:40.000Z' });
  });
  it('times out when Gmail does not answer opening a folder', async () => {
    const g = fakeGmail({ messages: [msg()], override: (c) => (c.startsWith('EXAMINE') ? null : undefined) });
    await expect(runSeedCheck(g.socket, query, Date.now() + 60)).rejects.toMatchObject({ code: 'timeout', signedIn: true });
  });
  it('looks at every match when there is no time', async () => {
    const r = (await runSeedCheck(fakeGmail({ messages: [msg({ date: '01-Nov-2026 09:00:00 +0000' })] }).socket, { ...query, days: 30, after: '' }, later())) as SeedFound;
    expect(r.found).toBe(true);
  });
});

const SHOP = '6f1c1d6e-1b7a-4a39-9a2e-0d4b4c1b2a10';
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ shopId: SHOP, address: 'canary.shop@gmail.com', sender: 'orders@juniperstitch.example', password: 'abcd efgh ijkl mnop', days: 1, ...over });

describe('the "after" field of POST /api/seed-check', () => {
  it('reads it as an ISO time', () => {
    expect(parseSeedBody(body())).toMatchObject({ after: '' });
    expect(parseSeedBody(body({ after: '' }))).toMatchObject({ after: '' });
    expect(parseSeedBody(body({ after: PLACED }))).toMatchObject({ after: PLACED });
    expect(parseSeedBody(body({ after: '2026-11-15T11:00:05+01:00' }))).toMatchObject({ after: PLACED });
  });
  it('refuses anything that is not a time', () => {
    for (const after of ['soon', 1763200805, null, true, {}]) expect(parseSeedBody(body({ after }))).toBe('Send "after" as a time (ISO 8601).');
  });
  it('hands it to the check', async () => {
    const checked: SeedQuery[] = [];
    const seed: SeedDeps = {
      key: null,
      record: async () => 'ok',
      secret: async () => null,
      save: async () => false,
      reachable: async () => true,
      check: async (q) => {
        checked.push(q);
        return { found: false };
      },
    };
    const deps: ApiDeps = { verifyUser: async (t) => (t.startsWith('good') ? 'user-1' : null), record: async () => 'ok', fetchFile: async () => { throw new Error('unused'); }, seed, shopify: memoryShopDeps() };
    const auth = { authorization: 'Bearer good-token-0123456789abc' };
    expect(await handleApi('POST', '/api/seed-check', body({ after: PLACED }), auth, deps)).toMatchObject({ status: 200, body: { found: false, outcome: 'not-found' } });
    expect(checked[0].after).toBe(PLACED);
    expect(await handleApi('POST', '/api/seed-check', body({ after: 'later' }), auth, deps)).toEqual({ status: 400, body: { error: 'Send "after" as a time (ISO 8601).' } });
    expect(checked).toHaveLength(1);
  });
});
