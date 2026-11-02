import { describe, expect, it } from 'vitest';
import {
  parseMinutes,
  formatWallTime,
  zoneOffsetMinutes,
  epochFor,
  formatInZone,
  sessionStatus,
  nowNext,
  timeRangeLabel,
  timeLabel,
} from '../src/core/clock';
import { makeSession } from './helpers';

const NY = 'America/New_York';

describe('parseMinutes / formatWallTime', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(parseMinutes('00:00')).toBe(0);
    expect(parseMinutes('09:30')).toBe(570);
    expect(parseMinutes('23:59')).toBe(1439);
  });

  it('formats 24h wall times as 12h strings', () => {
    expect(formatWallTime('00:05')).toBe('12:05 AM');
    expect(formatWallTime('09:00')).toBe('9:00 AM');
    expect(formatWallTime('12:00')).toBe('12:00 PM');
    expect(formatWallTime('13:05')).toBe('1:05 PM');
    expect(formatWallTime('23:30')).toBe('11:30 PM');
  });
});

describe('zoneOffsetMinutes / epochFor', () => {
  it('knows New York is UTC-4 in August (EDT) and UTC-5 in January (EST)', () => {
    expect(zoneOffsetMinutes(NY, Date.UTC(2026, 7, 31, 12, 0))).toBe(-240);
    expect(zoneOffsetMinutes(NY, Date.UTC(2026, 0, 15, 12, 0))).toBe(-300);
  });

  it('converts conference wall times to the right instant', () => {
    // 9:00 AM EDT == 13:00 UTC
    expect(epochFor('2026-08-31', '09:00', NY)).toBe(Date.UTC(2026, 7, 31, 13, 0));
    // 9:00 AM UTC is just 9:00 UTC
    expect(epochFor('2026-08-31', '09:00', 'UTC')).toBe(Date.UTC(2026, 7, 31, 9, 0));
    // Winter time: 9:00 AM EST == 14:00 UTC
    expect(epochFor('2026-01-15', '09:00', NY)).toBe(Date.UTC(2026, 0, 15, 14, 0));
  });

  it('round-trips through formatInZone', () => {
    const ms = epochFor('2026-09-01', '13:30', NY);
    expect(formatInZone(ms, NY)).toBe('1:30 PM');
    expect(formatInZone(ms, 'America/Los_Angeles')).toBe('10:30 AM');
    expect(formatInZone(ms, 'UTC')).toBe('5:30 PM');
  });
});

describe('sessionStatus', () => {
  const s = makeSession({ day: '2026-08-31', start: '09:00', end: '10:00' });

  it('classifies past, now, and future', () => {
    const start = epochFor('2026-08-31', '09:00', NY);
    const end = epochFor('2026-08-31', '10:00', NY);
    expect(sessionStatus(s, start - 1, NY)).toBe('future');
    expect(sessionStatus(s, start, NY)).toBe('now');
    expect(sessionStatus(s, end - 1, NY)).toBe('now');
    expect(sessionStatus(s, end, NY)).toBe('past');
  });
});

describe('nowNext', () => {
  const sessions = [
    makeSession({ id: 'k', day: '2026-08-31', start: '09:00', end: '10:00', title: 'Keynote' }),
    makeSession({ id: 'p1', day: '2026-08-31', start: '10:30', end: '12:00', title: 'B Track' }),
    makeSession({ id: 'p2', day: '2026-08-31', start: '10:30', end: '12:00', title: 'A Track' }),
    makeSession({ id: 'w', day: '2026-09-01', start: '09:00', end: '10:00', title: 'Day 2' }),
  ];

  it('is empty after the conference ends', () => {
    const after = epochFor('2026-09-01', '23:00', NY);
    const r = nowNext(sessions, after, NY);
    expect(r.now).toEqual([]);
    expect(r.next).toEqual([]);
    expect(r.nextStart).toBeUndefined();
  });

  it('reports only next before the conference starts', () => {
    const before = epochFor('2026-08-31', '07:00', NY);
    const r = nowNext(sessions, before, NY);
    expect(r.now).toEqual([]);
    expect(r.next.map((s) => s.id)).toEqual(['k']);
    expect(r.nextStart).toEqual({ day: '2026-08-31', start: '09:00' });
  });

  it('reports current and next parallel group, sorted by title', () => {
    const during = epochFor('2026-08-31', '09:30', NY);
    const r = nowNext(sessions, during, NY);
    expect(r.now.map((s) => s.id)).toEqual(['k']);
    expect(r.next.map((s) => s.title)).toEqual(['A Track', 'B Track']);
  });

  it('skips to the next day when the current day is over', () => {
    const evening = epochFor('2026-08-31', '18:00', NY);
    const r = nowNext(sessions, evening, NY);
    expect(r.now).toEqual([]);
    expect(r.next.map((s) => s.id)).toEqual(['w']);
  });
});

describe('timeRangeLabel', () => {
  const s = makeSession({ day: '2026-08-31', start: '13:30', end: '14:30' });

  it('uses wall time when viewing in the conference zone', () => {
    expect(timeRangeLabel(s, NY, null)).toBe('1:30 PM – 2:30 PM');
    expect(timeRangeLabel(s, NY, NY)).toBe('1:30 PM – 2:30 PM');
  });

  it('converts when viewing from another zone', () => {
    expect(timeRangeLabel(s, NY, 'America/Los_Angeles')).toBe('10:30 AM – 11:30 AM');
    expect(timeRangeLabel(s, NY, 'UTC')).toBe('5:30 PM – 6:30 PM');
  });
});

describe('timeLabel (time-slot headings)', () => {
  it('uses wall time in the conference zone', () => {
    expect(timeLabel('2026-08-31', '08:30', NY, null)).toBe('8:30 AM');
    expect(timeLabel('2026-08-31', '08:30', NY, NY)).toBe('8:30 AM');
  });

  it('converts to the viewer zone, matching the card time range', () => {
    // Regression: headings stayed in ET while cards switched to the viewer's zone.
    const s = makeSession({ day: '2026-08-31', start: '08:30', end: '09:00' });
    const LA = 'America/Los_Angeles';
    expect(timeLabel(s.day, s.start, NY, LA)).toBe('5:30 AM');
    expect(timeRangeLabel(s, NY, LA).startsWith(timeLabel(s.day, s.start, NY, LA) + ' –')).toBe(true);
  });
});
