import type { Session } from './types';

/** "09:30" -> 570. Input is assumed pre-validated (validateSchedule). */
export function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** "13:05" -> "1:05 PM" (conference wall time; no time zone math needed). */
export function formatWallTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function zoneOffsetMinutes(timeZone: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(atMs)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - atMs) / 60000);
}

/**
 * Epoch ms for a wall time ("YYYY-MM-DD" + "HH:MM") in an IANA time zone.
 * Two-pass offset correction handles DST edges well enough for a conference
 * schedule (no summit session starts inside a DST transition hour).
 */
export function epochFor(day: string, hhmm: string, timeZone: string): number {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const offset1 = zoneOffsetMinutes(timeZone, utcGuess);
  const guess2 = utcGuess - offset1 * 60000;
  const offset2 = zoneOffsetMinutes(timeZone, guess2);
  return utcGuess - offset2 * 60000;
}

/** Format an instant as "1:05 PM" in the given zone. */
export function formatInZone(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(epochMs);
}

export type SessionStatus = 'past' | 'now' | 'future';

export function sessionStatus(s: Session, nowMs: number, timeZone: string): SessionStatus {
  const startMs = epochFor(s.day, s.start, timeZone);
  const endMs = epochFor(s.day, s.end, timeZone);
  if (nowMs >= endMs) return 'past';
  if (nowMs >= startMs) return 'now';
  return 'future';
}

export interface NowNext {
  now: Session[];
  next: Session[];
  /** Start wall time shared by the `next` group, if any. */
  nextStart?: { day: string; start: string };
}

/**
 * What is on right now and the next group of sessions to start, across the
 * whole conference. Empty lists outside the conference window.
 */
export function nowNext(sessions: Session[], nowMs: number, timeZone: string): NowNext {
  const now: Session[] = [];
  let bestStartMs = Infinity;
  for (const s of sessions) {
    const startMs = epochFor(s.day, s.start, timeZone);
    const endMs = epochFor(s.day, s.end, timeZone);
    if (nowMs >= startMs && nowMs < endMs) now.push(s);
    else if (startMs > nowMs && startMs < bestStartMs) bestStartMs = startMs;
  }
  const next = Number.isFinite(bestStartMs)
    ? sessions.filter((s) => epochFor(s.day, s.start, timeZone) === bestStartMs)
    : [];
  const sortByTitle = (a: Session, b: Session) => a.title.localeCompare(b.title);
  now.sort(sortByTitle);
  next.sort(sortByTitle);
  const result: NowNext = { now, next };
  if (next.length > 0) result.nextStart = { day: next[0].day, start: next[0].start };
  return result;
}

/**
 * Session time range for display: conference wall time, or converted to the
 * viewer's zone when `viewZone` differs from the conference zone.
 */
export function timeRangeLabel(
  s: Session,
  confZone: string,
  viewZone: string | null,
): string {
  return `${timeLabel(s.day, s.start, confZone, viewZone)} – ${timeLabel(s.day, s.end, confZone, viewZone)}`;
}

/**
 * One conference wall time ("YYYY-MM-DD" + "HH:MM") for display, converted to
 * `viewZone` when it differs from the conference zone. Used for time-slot
 * headings so they always match the session cards beneath them.
 */
export function timeLabel(
  day: string,
  hhmm: string,
  confZone: string,
  viewZone: string | null,
): string {
  if (!viewZone || viewZone === confZone) return formatWallTime(hhmm);
  return formatInZone(epochFor(day, hhmm, confZone), viewZone);
}
