/**
 * The wait between sign-in links (src/signin/README.md). Pure: the counts
 * come from platform.sign_in_begin, the clock from the caller.
 *
 * Between links to one address (and, separately, links asked for from one
 * browser) the wait grows 1, 3, 5, 8, 13, 21 minutes and then by adding the
 * previous two (34, 55, 89, ...), capped at 24 hours. Only links sent since
 * the last quiet day count: 24 hours without any request for the key resets
 * the ladder (the SQL finds that start, platform.sign_in_episode_start).
 */

export const LADDER_MINUTES: readonly number[] = [1, 3, 5, 8, 13, 21];
export const LADDER_CAP_MINUTES = 24 * 60;
/** A day with no request for a key resets its ladder (also in the SQL). */
export const QUIET_HOURS = 24;

const MINUTE = 60_000;

/**
 * Minutes to wait after the `sent`-th link of the current ladder before the
 * next one: 0 before the first link, 1 after the first, 3 after the second,
 * and so on up to the 24-hour cap.
 */
export function gapMinutes(sent: number): number {
  if (!Number.isFinite(sent) || sent < 1) return 0;
  const n = Math.floor(sent);
  if (n <= LADDER_MINUTES.length) return Math.min(LADDER_MINUTES[n - 1], LADDER_CAP_MINUTES);
  let a = LADDER_MINUTES[LADDER_MINUTES.length - 2];
  let b = LADDER_MINUTES[LADDER_MINUTES.length - 1];
  for (let i = LADDER_MINUTES.length; i < n; i += 1) {
    [a, b] = [b, a + b];
    if (b >= LADDER_CAP_MINUTES) return LADDER_CAP_MINUTES;
  }
  return b;
}

/** One key's ladder: links sent since its last quiet day, and when the last one went. */
export interface Ladder {
  sent: number;
  lastSentAt: string | null;
}

/** When the next link for this key may go, or null when it may go now. */
export function nextAllowed(ladder: Ladder, now: Date): Date | null {
  if (!(ladder.sent > 0) || !ladder.lastSentAt) return null;
  const last = Date.parse(ladder.lastSentAt);
  if (Number.isNaN(last)) return null;
  const at = last + gapMinutes(ladder.sent) * MINUTE;
  return at > now.getTime() ? new Date(at) : null;
}
