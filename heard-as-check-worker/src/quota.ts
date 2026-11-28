/**
 * AC-25: 20 checks a day per person and 60 a day in all, by UTC day. The
 * counters live in memory: a hub restart resets them, by design. A check is
 * counted when its job is accepted. From M6 a CI check counts under its key
 * owner's id, in the same counters.
 */
export const PERSON_LIMIT_MESSAGE = "You have used today's 20 checks. They reset at midnight UTC.";
export const ALL_LIMIT_MESSAGE = "The checker has reached today's limit for everyone.";

export type Verdict = { ok: true } | { ok: false; reason: 'daily-limit' | 'all-limit'; message: string; retryAfter: number };

const DAY = 86_400_000;

export class Quota {
  private day = -1;
  private all = 0;
  private readonly people = new Map<string, number>();
  private readonly perPerson: number;
  private readonly total: number;
  private readonly now: () => number;

  constructor(perPerson: number, total: number, now: () => number = Date.now) {
    this.perPerson = perPerson;
    this.total = total;
    this.now = now;
  }

  private roll(): void {
    const day = Math.floor(this.now() / DAY);
    if (day !== this.day) {
      this.day = day;
      this.all = 0;
      this.people.clear();
    }
  }

  /** Seconds until the next midnight UTC, at least 1. */
  secondsToReset(): number {
    return Math.max(1, Math.ceil(((Math.floor(this.now() / DAY) + 1) * DAY - this.now()) / 1000));
  }

  check(userId: string): Verdict {
    this.roll();
    if ((this.people.get(userId) ?? 0) >= this.perPerson) return { ok: false, reason: 'daily-limit', message: PERSON_LIMIT_MESSAGE, retryAfter: this.secondsToReset() };
    if (this.all >= this.total) return { ok: false, reason: 'all-limit', message: ALL_LIMIT_MESSAGE, retryAfter: this.secondsToReset() };
    return { ok: true };
  }

  count(userId: string): void {
    this.roll();
    this.people.set(userId, (this.people.get(userId) ?? 0) + 1);
    this.all++;
  }

  left(userId: string): number {
    this.roll();
    return Math.max(0, Math.min(this.perPerson - (this.people.get(userId) ?? 0), this.total - this.all));
  }
}
