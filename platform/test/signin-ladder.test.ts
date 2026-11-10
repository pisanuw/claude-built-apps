import { describe, expect, it } from 'vitest';
import { gapMinutes, LADDER_CAP_MINUTES, nextAllowed } from '../src/signin/ladder.ts';
import { DAY_CHALLENGE_REQUESTS, decide, decisionDetail, IP_FREE_PER_HOUR, IP_HARD_LIMIT_PER_HOUR, ladderOnly, PROJECT_SENT_BRAKE_PER_HOUR, type KeyStats } from '../src/signin/policy.ts';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const key = (over: Partial<KeyStats> = {}): KeyStats => ({ sent: 0, last_sent_at: null, requests_24h: 0, ...over });
const ip = (requests_1h = 0) => ({ requests_1h });

describe('gapMinutes', () => {
  it('is 0 before the first link, then 1, 3, 5, 8, 13, 21', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(gapMinutes)).toEqual([0, 1, 3, 5, 8, 13, 21]);
  });
  it('then adds the previous two: 34, 55, 89, 144, 233, 377, 610, 987', () => {
    expect([7, 8, 9, 10, 11, 12, 13, 14].map(gapMinutes)).toEqual([34, 55, 89, 144, 233, 377, 610, 987]);
  });
  it('is capped at 24 hours', () => {
    expect(gapMinutes(15)).toBe(LADDER_CAP_MINUTES);
    expect(gapMinutes(40)).toBe(1440);
    expect(gapMinutes(1e9)).toBe(1440);
  });
  it('treats junk as no link sent and rounds fractions down', () => {
    expect(gapMinutes(Number.NaN)).toBe(0);
    expect(gapMinutes(-3)).toBe(0);
    expect(gapMinutes(2.9)).toBe(3);
  });
});

describe('nextAllowed', () => {
  it('lets the first link go at once', () => {
    expect(nextAllowed({ sent: 0, lastSentAt: null }, NOW)).toBeNull();
    expect(nextAllowed({ sent: 2, lastSentAt: null }, NOW)).toBeNull();
    expect(nextAllowed({ sent: 1, lastSentAt: 'not a date' }, NOW)).toBeNull();
  });
  it('waits the ladder step after the last link', () => {
    expect(nextAllowed({ sent: 1, lastSentAt: ago(0.5) }, NOW)?.toISOString()).toBe('2026-11-10T12:00:30.000Z');
    expect(nextAllowed({ sent: 3, lastSentAt: ago(2) }, NOW)?.toISOString()).toBe('2026-11-10T12:03:00.000Z');
  });
  it('allows the link once the step has passed, exactly at the boundary too', () => {
    expect(nextAllowed({ sent: 1, lastSentAt: ago(1) }, NOW)).toBeNull();
    expect(nextAllowed({ sent: 2, lastSentAt: ago(10) }, NOW)).toBeNull();
  });
});

describe('decide', () => {
  it('sends a first link without a challenge', () => {
    expect(decide({ email: key(), browser: key(), ip: ip() }, NOW)).toEqual({ action: 'send', challenge: [] });
  });
  it('waits for the address ladder', () => {
    const d = decide({ email: key({ sent: 2, last_sent_at: ago(1) }), browser: key(), ip: ip() }, NOW);
    expect(d).toEqual({ action: 'wait', retryAt: '2026-11-10T12:02:00.000Z', keys: ['email'] });
  });
  it('waits for the browser ladder, and for the later of the two', () => {
    expect(decide({ email: key(), browser: key({ sent: 1, last_sent_at: ago(0) }), ip: ip() }, NOW)).toMatchObject({ action: 'wait', keys: ['browser'] });
    const d = decide({ email: key({ sent: 1, last_sent_at: ago(0) }), browser: key({ sent: 4, last_sent_at: ago(1) }), ip: ip() }, NOW);
    expect(d).toEqual({ action: 'wait', retryAt: '2026-11-10T12:07:00.000Z', keys: ['email', 'browser'] });
  });
  it('accepts counts as strings', () => {
    const d = decide({ email: { sent: '1', last_sent_at: ago(0), requests_24h: '0' } as unknown as KeyStats, browser: key(), ip: ip() }, NOW);
    expect(d.action).toBe('wait');
  });
  it('asks for the challenge on the 10th request of the day for one address or one browser', () => {
    const below = DAY_CHALLENGE_REQUESTS - 2;
    expect(decide({ email: key({ requests_24h: below }), browser: key({ requests_24h: below }), ip: ip() }, NOW)).toEqual({ action: 'send', challenge: [] });
    const at = DAY_CHALLENGE_REQUESTS - 1;
    expect(decide({ email: key({ requests_24h: at }), browser: key(), ip: ip() }, NOW)).toEqual({ action: 'send', challenge: ['address-day'] });
    expect(decide({ email: key(), browser: key({ requests_24h: at }), ip: ip() }, NOW)).toEqual({ action: 'send', challenge: ['browser-day'] });
  });
  it('lets one IP have 20 requests an hour free and challenges the 21st', () => {
    expect(decide({ email: key(), browser: key(), ip: ip(IP_FREE_PER_HOUR - 1) }, NOW)).toEqual({ action: 'send', challenge: [] });
    expect(decide({ email: key(), browser: key(), ip: ip(IP_FREE_PER_HOUR) }, NOW)).toEqual({ action: 'send', challenge: ['ip-hour'] });
  });
  it('makes the challenge due when the IP is unknown', () => {
    expect(decide({ email: key(), browser: key(), ip: ip(0) }, NOW, false)).toEqual({ action: 'send', challenge: ['ip-unknown'] });
  });
  it('makes the challenge due for everyone while the project is over its hourly brake', () => {
    expect(PROJECT_SENT_BRAKE_PER_HOUR).toBe(100);
    expect(IP_HARD_LIMIT_PER_HOUR).toBe(100);
    expect(decide({ email: key(), browser: key(), ip: ip(), project: { sent_1h: 100 } }, NOW)).toEqual({ action: 'send', challenge: [] });
    expect(decide({ email: key(), browser: key(), ip: ip(), project: { sent_1h: 101 } }, NOW)).toEqual({ action: 'send', challenge: ['project-hour'] });
  });
  it('applies only the address ladder for the send-email hook', () => {
    expect(ladderOnly(key(), NOW)).toEqual({ action: 'send' });
    expect(ladderOnly(key({ sent: 3, last_sent_at: ago(1) }), NOW)).toEqual({ action: 'wait', retryAt: '2026-11-10T12:04:00.000Z' });
    expect(ladderOnly(undefined as unknown as KeyStats, NOW)).toEqual({ action: 'send' });
  });
  it('waits before it challenges: a challenge cannot shorten the wait', () => {
    const d = decide({ email: key({ sent: 1, last_sent_at: ago(0), requests_24h: 30 }), browser: key(), ip: ip(100) }, NOW);
    expect(d.action).toBe('wait');
  });
  it('copes with missing parts', () => {
    expect(decide({} as never, NOW)).toEqual({ action: 'send', challenge: [] });
  });
});

describe('decisionDetail', () => {
  it('names the ladders or the challenge rules', () => {
    const stats = { email: key({ sent: 3 }), browser: key({ sent: 1 }) };
    expect(decisionDetail({ action: 'wait', retryAt: 'x', keys: ['email', 'browser'] }, stats)).toBe('wait: email ladder at 3 sent, browser ladder at 1 sent');
    expect(decisionDetail({ action: 'send', challenge: ['address-day', 'ip-hour'] }, stats)).toBe('challenge: address-day, ip-hour');
    expect(decisionDetail({ action: 'send', challenge: [] }, stats)).toBe('');
  });
});
