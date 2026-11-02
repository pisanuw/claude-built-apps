import { describe, expect, it } from 'vitest';
import { interpretInput } from '../src/core/interpret.js';
import { expandSchedule } from '../src/core/expand.js';

describe('interpretInput', () => {
  it('recognizes a plain cron expression', () => {
    const r = interpretInput('15 4 * * 1-5');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe('cron');
      expect(r.cron).toBe('15 4 * * 1-5');
      expect(r.description).toBe('At 04:15 on Monday through Friday');
    }
  });

  it('recognizes @shortcuts and RRULEs', () => {
    const daily = interpretInput('@daily');
    expect(daily.ok && daily.kind === 'cron').toBe(true);
    const rrule = interpretInput('FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9');
    expect(rrule.ok).toBe(true);
    if (rrule.ok) {
      expect(rrule.kind).toBe('rrule');
      expect(rrule.cron).toBeNull();
      expect(rrule.description).toBe('Every week on Monday and Friday at 09:00');
    }
  });

  it('recognizes a pasted GitHub Actions snippet', () => {
    const r = interpretInput('on:\n  schedule:\n    - cron: "15 4 * * 1-5"\n    - cron: "0 0 * * 0"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe('github-actions');
      expect(r.cron).toBe('15 4 * * 1-5');
      expect(r.notes.join(' ')).toMatch(/UTC/);
      expect(r.notes.join(' ')).toMatch(/2 cron entries/);
    }
  });

  it('falls back to natural language', () => {
    const r = interpretInput('every weekday at 4:15am');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe('natural-language');
      expect(r.cron).toBe('15 4 * * 1-5');
    }
  });

  it('turns "last friday of every month" into an exact RRULE schedule', () => {
    const r = interpretInput('last friday of every month at 5pm');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe('natural-language');
      expect(r.cron).toBeNull();
      expect(r.schedule.kind).toBe('rrule');
      expect(r.schedule.source).toBe('FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0');
      expect(r.description).toBe('Every month on the last Friday at 17:00');
      expect(r.notes.join(' ')).toMatch(/cron cannot express/);
      // Fires only on the last Friday of each month, never on the 1st or
      // any other Friday (what the old "0 17 1 * 5" did).
      const out = expandSchedule(r.schedule, {
        scheduleZone: 'UTC',
        displayZone: 'UTC',
        horizonDays: 365,
        startMs: Date.UTC(2026, 0, 1),
      });
      expect(out.days.filter((d) => d.count > 0).map((d) => d.date)).toEqual([
        '2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29', '2026-06-26',
        '2026-07-31', '2026-08-28', '2026-09-25', '2026-10-30', '2026-11-27', '2026-12-25',
      ]);
      expect(out.next[0].scheduleWall).toMatchObject({ hour: 17, minute: 0 });
    }
  });

  it('keeps the cron error for cron-shaped input', () => {
    const r = interpretInput('61 4 * * *');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/out of range/);
  });

  it('reports honest failure for unparseable input', () => {
    const empty = interpretInput('   ');
    expect(empty.ok).toBe(false);
    const gibberish = interpretInput('the quick brown fox');
    expect(gibberish.ok).toBe(false);
    if (!gibberish.ok) expect(gibberish.hint).toMatch(/every weekday/);
    const badRRule = interpretInput('FREQ=SECONDLY');
    expect(badRRule.ok).toBe(false);
    if (!badRRule.ok) expect(badRRule.error).toMatch(/RRULE/);
  });
});
