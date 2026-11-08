import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { parseHar } from '../src/core/capture';
import { diffChecks, toSaved } from '../src/core/check';
import { DISCLAIMER, reminderIcs, toMarkdown } from '../src/core/export';
import { sampleHar } from '../src/core/sample';

describe('exports', () => {
  const P = { practice: 'unsure' as const, states: [] };
  const last = analyze(parseHar(sampleHar(false)), P, {}, new Date('2026-10-06T00:00:00Z'));
  const now = analyze(parseHar(sampleHar(true)), P, {}, new Date('2026-11-06T00:00:00Z'));

  it('writes a markdown summary with the diff', () => {
    const md = toMarkdown(now, diffChecks(toSaved(last), now));
    expect(md).toMatch(/^# Health page tracker check: harborview-counseling.example/);
    expect(md).toContain('## Since the check of 2026-10-06');
    expect(md).toContain('- New: Hotjar');
    expect(md).toContain('Meta Pixel (Facebook / Instagram) (/book)');
    expect(md).toContain('## Review now');
    expect(md).toContain('## Makers that sign a BAA');
    expect(md).toContain('| /book | Booking |');
    expect(md).toContain(DISCLAIMER);
  });

  it('writes a markdown summary without a diff, including BAA changes and warnings', () => {
    const prev = toSaved(now);
    const meta = prev.tools.find((t) => t.key === 'meta-pixel');
    if (meta) meta.baa = 'ask';
    const md = toMarkdown(now, diffChecks(prev, now));
    expect(md).toContain('BAA position changed: Meta Pixel');
    const plain = toMarkdown({ ...now, warnings: ['Careful'], tools: [] }, null);
    expect(plain).not.toContain('Since the check');
    expect(plain).toContain('> Careful');
    expect(plain).not.toContain('## Review now');
  });

  it('writes a monthly calendar reminder', () => {
    const ics = reminderIcs('clinic.test', 'https://health-page-tracker-watch.hintwise.org', new Date('2026-01-31T10:00:00Z'));
    expect(ics).toContain('RRULE:FREQ=MONTHLY');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260228');
    expect(ics).toContain('DTEND;VALUE=DATE:20260301');
    expect(ics).toContain('SUMMARY:Check clinic.test health pages for new trackers');
    expect(ics).toContain('DTSTAMP:20260131T100000Z');
    expect(ics).toMatch(/^UID:health-page-tracker-watch-clinic\.test-\d{8}@hintwise\.org\r$/m);
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
    expect(reminderIcs('a;b,c', 'u', new Date('2026-12-05T00:00:00Z'))).toContain(String.raw`SUMMARY:Check a\;b\,c health`);
    expect(reminderIcs('x', 'u', new Date('2026-12-05T00:00:00Z'))).toContain('DTSTART;VALUE=DATE:20270105');
  });
});
