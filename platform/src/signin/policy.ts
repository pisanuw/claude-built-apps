/**
 * The decision for one sign-in link request (src/signin/README.md): wait,
 * send, or send only after a Turnstile challenge. Pure: the counts come from
 * platform.sign_in_begin (which does not count the request being decided).
 */
import { nextAllowed } from './ladder.ts';
import { num as n } from './util.ts';

/** A request of one address or one browser that reaches this many in 24 hours needs the challenge. */
export const DAY_CHALLENGE_REQUESTS = 10;
/** Requests from one IP network an hour that pass without a challenge (classrooms share an IP). */
export const IP_FREE_PER_HOUR = 20;
/** Above this many requests an hour from one IP network the answer is a wait, with no row written (sign_in_begin). */
export const IP_HARD_LIMIT_PER_HOUR = 100;
/** When more links than this went out project-wide in the last hour, every request needs the challenge. */
export const PROJECT_SENT_BRAKE_PER_HOUR = 100;

/** One key's counts as platform.sign_in_key_stats returns them. */
export interface KeyStats {
  /** Links sent (or being sent) since the key's last quiet day. */
  sent: number;
  last_sent_at: string | null;
  /** Requests in the last 24 hours, not counting invalid or refused ones. */
  requests_24h: number;
  episode_start?: string | null;
}

export interface IpStats {
  /** Requests from the IP network in the last hour (any outcome). */
  requests_1h: number;
}

/**
 * What platform.sign_in_begin returns: the new request's id and the counts
 * before it, or { limited: true, retry_at } when the IP network is over the
 * hard limit (no row was written).
 */
export type BeginResult =
  | { limited?: false; id: number; email: KeyStats; browser: KeyStats; ip: IpStats; project?: { sent_1h: number } }
  | { limited: true; retry_at: string };

export type Stats = Exclude<BeginResult, { limited: true }>;

export type ChallengeReason = 'address-day' | 'browser-day' | 'ip-hour' | 'ip-unknown' | 'project-hour';

export type Decision =
  | { action: 'wait'; retryAt: string; keys: Array<'email' | 'browser'> }
  | { action: 'send'; challenge: ChallengeReason[] };

/**
 * Wait when either ladder says so (the later time wins); otherwise send,
 * listing why a challenge is needed first, if it is. A request whose IP is
 * unknown (no usable header reached the function) always needs the
 * challenge, and so does every request while the project is over its
 * hourly brake.
 */
export function decide(stats: Pick<Stats, 'email' | 'browser' | 'ip' | 'project'>, now: Date, ipKnown = true): Decision {
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
  if (!ipKnown) challenge.push('ip-unknown');
  else if (n(stats.ip?.requests_1h) + 1 > IP_FREE_PER_HOUR) challenge.push('ip-hour');
  if (n(stats.project?.sent_1h) > PROJECT_SENT_BRAKE_PER_HOUR) challenge.push('project-hour');
  return { action: 'send', challenge };
}

/** Only the per-address ladder: the send-email hook's rule (no browser, no IP, no challenge). */
export function ladderOnly(email: KeyStats, now: Date): { action: 'wait'; retryAt: string } | { action: 'send' } {
  const at = nextAllowed({ sent: n(email?.sent), lastSentAt: email?.last_sent_at ?? null }, now);
  return at ? { action: 'wait', retryAt: at.toISOString() } : { action: 'send' };
}

/** The detail column for a decision: which ladders or which challenge rules. */
export function decisionDetail(d: Decision, stats: Pick<Stats, 'email' | 'browser'>): string {
  if (d.action === 'wait') return `wait: ${d.keys.map((k) => `${k} ladder at ${n(stats[k]?.sent)} sent`).join(', ')}`;
  return d.challenge.length ? `challenge: ${d.challenge.join(', ')}` : '';
}
