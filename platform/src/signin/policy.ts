/**
 * The decision for one sign-in link request (src/signin/README.md): wait,
 * send, or send only after a Turnstile challenge. Pure: the counts come from
 * platform.sign_in_begin (which does not count the request being decided).
 */
import { nextAllowed } from './ladder.ts';

/** A request of one address or one browser that reaches this many in 24 hours needs the challenge. */
export const DAY_CHALLENGE_REQUESTS = 10;
/** Requests from one IP an hour that pass without a challenge (classrooms share an IP). */
export const IP_FREE_PER_HOUR = 20;

/** One key's counts as platform.sign_in_key_stats returns them. */
export interface KeyStats {
  /** Links sent (or being sent) since the key's last quiet day. */
  sent: number;
  last_sent_at: string | null;
  /** Requests with any outcome in the last 24 hours. */
  requests_24h: number;
  episode_start?: string | null;
}

export interface IpStats {
  requests_1h: number;
  requests_24h: number;
}

/** What platform.sign_in_begin returns: the new request's id and the counts before it. */
export interface BeginResult {
  id: number;
  email: KeyStats;
  browser: KeyStats;
  ip: IpStats;
}

export type ChallengeReason = 'address-day' | 'browser-day' | 'ip-hour';

export type Decision =
  | { action: 'wait'; retryAt: string; keys: Array<'email' | 'browser'> }
  | { action: 'send'; challenge: ChallengeReason[] };

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};

/**
 * Wait when either ladder says so (the later time wins); otherwise send,
 * listing why a challenge is needed first, if it is. `ipKnown` false (no IP
 * header reached the function) skips the per-IP rule rather than lumping
 * every visitor into one "unknown" IP.
 */
export function decide(stats: Pick<BeginResult, 'email' | 'browser' | 'ip'>, now: Date, ipKnown = true): Decision {
  const waits: Array<['email' | 'browser', Date]> = [];
  for (const key of ['email', 'browser'] as const) {
    const s = stats[key];
    const at = nextAllowed({ sent: n(s?.sent), lastSentAt: s?.last_sent_at ?? null }, now);
    if (at) waits.push([key, at]);
  }
  if (waits.length) {
    const latest = Math.max(...waits.map(([, at]) => at.getTime()));
    return { action: 'wait', retryAt: new Date(latest).toISOString(), keys: waits.map(([k]) => k) };
  }

  const challenge: ChallengeReason[] = [];
  // The counts exclude this request, hence the + 1.
  if (n(stats.email?.requests_24h) + 1 >= DAY_CHALLENGE_REQUESTS) challenge.push('address-day');
  if (n(stats.browser?.requests_24h) + 1 >= DAY_CHALLENGE_REQUESTS) challenge.push('browser-day');
  if (ipKnown && n(stats.ip?.requests_1h) + 1 > IP_FREE_PER_HOUR) challenge.push('ip-hour');
  return { action: 'send', challenge };
}

/** The detail column for a decision: which ladders or which challenge rules. */
export function decisionDetail(d: Decision, stats: Pick<BeginResult, 'email' | 'browser'>): string {
  if (d.action === 'wait') return `wait: ${d.keys.map((k) => `${k} ladder at ${n(stats[k]?.sent)} sent`).join(', ')}`;
  return d.challenge.length ? `challenge: ${d.challenge.join(', ')}` : '';
}
