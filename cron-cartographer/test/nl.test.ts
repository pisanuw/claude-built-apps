import { describe, expect, it } from 'vitest';
import { naturalLanguageToCron } from '../src/core/nl.js';

const cron = (text: string): string | null => naturalLanguageToCron(text)?.cron ?? null;

describe('naturalLanguageToCron', () => {
  it('handles the flagship example', () => {
    expect(cron('every weekday at 4:15am')).toBe('15 4 * * 1-5');
  });

  it('handles minute and hour intervals', () => {
    expect(cron('every 5 minutes')).toBe('*/5 * * * *');
    expect(cron('every minute')).toBe('* * * * *');
    expect(cron('every 2 hours')).toBe('0 */2 * * *');
    expect(cron('hourly')).toBe('0 * * * *');
  });

  it('handles times of day in several forms', () => {
    expect(cron('daily at 9am')).toBe('0 9 * * *');
    expect(cron('every day at 16:30')).toBe('30 16 * * *');
    expect(cron('at noon')).toBe('0 12 * * *');
    expect(cron('at midnight')).toBe('0 0 * * *');
    expect(cron('every day at 6am and 6pm')).toBe('0 6,18 * * *');
    expect(cron('at 12pm')).toBe('0 12 * * *');
    expect(cron('at 12am')).toBe('0 0 * * *');
  });

  it('handles weekdays, weekends, and named days', () => {
    expect(cron('weekdays at 8am')).toBe('0 8 * * 1-5');
    expect(cron('weekends at noon')).toBe('0 12 * * 0,6');
    expect(cron('every monday and friday at 9:30pm')).toBe('30 21 * * 1,5');
    expect(cron('on tuesdays')).toBe('0 0 * * 2');
  });

  it('handles day-of-month and month phrases', () => {
    expect(cron('at midnight on the first of each month')).toBe('0 0 1 * *');
    expect(cron('on the 15th at 6am')).toBe('0 6 15 * *');
    expect(cron('monthly')).toBe('0 0 1 * *');
    expect(cron('every quarter')).toBe('0 0 1 1,4,7,10 *');
    expect(cron('yearly')).toBe('0 0 1 1 *');
    expect(cron('every day in january at 8am')).toBe('0 8 * 1 *');
  });

  it('notes assumptions it makes', () => {
    const r = naturalLanguageToCron('weekly');
    expect(r?.cron).toBe('0 0 * * 1');
    expect(r?.notes.join(' ')).toMatch(/Monday/);
    expect(r?.notes.join(' ')).toMatch(/00:00/);
  });

  it('handles "every other day" with a month-boundary note', () => {
    const r = naturalLanguageToCron('every other day at 7am');
    expect(r?.cron).toBe('0 7 */2 * *');
    expect(r?.notes.join(' ')).toMatch(/month boundary/);
  });

  it('is honest about what cron cannot express', () => {
    expect(naturalLanguageToCron('every 2 weeks')).toBeNull();
    expect(naturalLanguageToCron('on the last day of the month')).toBeNull();
  });

  describe('ordinal weekdays ("last Friday of the month")', () => {
    // Cron ORs day-of-month with day-of-week, so it cannot say "the last
    // Friday"; the converter must hand back an RRULE, never a cron.
    const rrule = (text: string): string | null => naturalLanguageToCron(text)?.rrule ?? null;

    it('converts "last friday of every month at 5pm" to an RRULE, not cron', () => {
      const r = naturalLanguageToCron('last friday of every month at 5pm');
      expect(r?.cron).toBeNull();
      expect(r?.rrule).toBe('FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=17;BYMINUTE=0');
      expect(r?.notes.join(' ')).toMatch(/cron cannot express "the last Friday of the month"/);
      expect(r?.notes.join(' ')).not.toMatch(/1st of the month/);
    });

    it('handles the sibling phrasings', () => {
      expect(rrule('last monday of the month')).toBe('FREQ=MONTHLY;BYDAY=-1MO;BYHOUR=0;BYMINUTE=0');
      expect(rrule('first friday of every month at 9am')).toBe('FREQ=MONTHLY;BYDAY=1FR;BYHOUR=9;BYMINUTE=0');
      expect(rrule('second tuesday of each month')).toBe('FREQ=MONTHLY;BYDAY=2TU;BYHOUR=0;BYMINUTE=0');
      expect(rrule('on the 3rd wednesday at 14:30')).toBe('FREQ=MONTHLY;BYDAY=3WE;BYHOUR=14;BYMINUTE=30');
      expect(rrule('second-to-last thursday of the month')).toBe('FREQ=MONTHLY;BYDAY=-2TH;BYHOUR=0;BYMINUTE=0');
      expect(rrule('first monday and last friday of the month at 8am')).toBe(
        'FREQ=MONTHLY;BYDAY=1MO,-1FR;BYHOUR=8;BYMINUTE=0',
      );
      expect(naturalLanguageToCron('last monday of the month')?.notes.join(' ')).toMatch(/00:00/);
    });

    it('carries months and month intervals into the RRULE', () => {
      expect(rrule('last friday of december at 5pm')).toBe('FREQ=MONTHLY;BYDAY=-1FR;BYMONTH=12;BYHOUR=17;BYMINUTE=0');
      expect(rrule('first monday of every quarter')).toBe('FREQ=MONTHLY;BYDAY=1MO;BYMONTH=1,4,7,10;BYHOUR=0;BYMINUTE=0');
      const r = naturalLanguageToCron('first monday of every other month at 9am');
      expect(r?.rrule).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=1MO;BYHOUR=9;BYMINUTE=0');
      expect(r?.notes.join(' ')).toMatch(/preview window/);
      expect(naturalLanguageToCron('last friday at 9:15am and 5pm')?.notes.join(' ')).toMatch(/different minutes/);
    });

    it('refuses combinations it cannot express exactly', () => {
      expect(naturalLanguageToCron('last friday and the 15th of the month')).toBeNull();
      expect(naturalLanguageToCron('last friday of the month and every monday')).toBeNull();
      expect(naturalLanguageToCron('every 10 minutes on the last friday')).toBeNull();
      expect(naturalLanguageToCron('last friday of every year')).toBeNull();
      // "the last weekday" needs BYSETPOS, which is not supported; it must
      // not degrade to "every weekday".
      expect(naturalLanguageToCron('last weekday of the month')).toBeNull();
      expect(naturalLanguageToCron('first business day of the month at 9am')).toBeNull();
    });

    it('leaves plain weekday and first-of-month phrases on cron', () => {
      expect(naturalLanguageToCron('every friday at 5pm')).toEqual({ cron: '0 17 * * 5', rrule: null, notes: [] });
      expect(cron('at midnight on the first of each month')).toBe('0 0 1 * *');
      expect(cron('first day of every month at 9am')).toBe('0 9 1 * *');
    });
  });

  it('returns null for input with no schedule signal', () => {
    expect(naturalLanguageToCron('hello world')).toBeNull();
    expect(naturalLanguageToCron('')).toBeNull();
    expect(naturalLanguageToCron('the quick brown fox')).toBeNull();
  });
});
