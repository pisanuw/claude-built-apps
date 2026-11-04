import { describe, expect, it } from 'vitest';
import { buildStatement, diffLines, escapeHtml, statementHtml, statementText, statusLabel } from '../src/core/statement';
import { check, fleet, site } from './helpers';

const TODAY = '2026-11-04';

describe('statement', () => {
  it('is partially conformant while target issues are open, and lists them in plain words', () => {
    const s = site('s1', { jurisdiction: 'both', knownLimits: 'Booking widget is third party.\n\nOld PDF menus.' });
    const f = fleet([s], [check('s1', '2026-10-30', { '/': ['color-contrast', 'region', 'target-size'], '/menu': ['color-contrast'], '/order': ['label'] })], {
      notes: { 's1|https://shop.example.com/order|label': 'Vendor ticket open.' },
    });
    const doc = buildStatement(f, s, TODAY);
    expect(doc.status).toBe('partial');
    expect(doc.title).toBe('Accessibility statement for Shop');
    const text = statementText(doc);
    expect(text).toContain('## Conformance status: Partially conformant');
    expect(text).toContain('- Some text does not stand out enough from its background to be read easily. (WCAG 1.4.3 Contrast (Minimum), on 2 pages, for example /, /menu.)');
    expect(text).toContain('(WCAG 4.1.2 Name, Role, Value, on /order.) Vendor ticket open.');
    expect(text).not.toContain('2.5.8');
    expect(text).toContain('We also track 2 improvements that go beyond WCAG 2.1 level AA.');
    expect(text).toContain('EN 301 549');
    expect(text).toContain('Americans with Disabilities Act');
    expect(text).toContain('MLBF');
    expect(text).toContain('Booking widget is third party.\n\nOld PDF menus.');
    expect(text).toContain('The site has not yet had a full review by a person.');
    expect(text).toContain('prepared on 4 November 2026 using the results of the check on 30 October 2026');
  });

  it('does not claim conformance from automated checks alone', () => {
    const s = site('s1', { jurisdiction: 'us', target: '2.2' });
    const f = fleet([s], [check('s1', '2026-10-30', { '/': ['region'] })]);
    const doc = buildStatement(f, s, TODAY);
    expect(doc.status).toBe('unconfirmed');
    const text = statementText(doc);
    expect(text).toContain('Not yet confirmed');
    expect(text).toContain('We also track 1 improvement that goes beyond');
    expect(text).not.toContain('EN 301 549');
    expect(text).not.toContain('MLBF');
  });

  it('says "as far as we know" only after a recent manual review', () => {
    const s = site('s1', { jurisdiction: 'eu', target: '2.2', manualReview: '2026-09-01' });
    const f = fleet([s], [check('s1', '2026-10-30', { '/': [] })]);
    const doc = buildStatement(f, s, TODAY);
    expect(doc.status).toBe('believed');
    const text = statementText(doc);
    expect(text).toContain('last reviewed by a person on 1 September 2026');
    expect(text).toContain('It includes everything in WCAG 2.1 level AA');
    expect(text).not.toContain('Americans');
    const stale = { ...s, manualReview: '2025-01-01' };
    expect(buildStatement(f, stale, TODAY).status).toBe('unconfirmed');
  });

  it('handles a site with no checks and missing details', () => {
    const s = site('s1', { name: '', owner: '', client: '', url: '', contactEmail: '' });
    const doc = buildStatement(fleet([s]), s, TODAY);
    expect(doc.status).toBe('partial');
    const text = statementText(doc);
    expect(doc.title).toBe('Accessibility statement for [website address]');
    expect(text).toContain('[organisation name] wants [website address]');
    expect(text).toContain('has not been checked yet');
    expect(text).toContain('[contact email]');
    expect(text).not.toContain('How we checked');
    expect(statusLabel('believed')).toBe('Meets the standard as far as we know');
  });

  it('renders escaped HTML', () => {
    const s = site('s1', { name: 'Tom & <Jerry>' });
    const f = fleet([s], [check('s1', '2026-10-30', { '/': ['label'] })]);
    const html = statementHtml(buildStatement(f, s, TODAY));
    expect(html).toContain('<h1>Accessibility statement for Tom &amp; &lt;Jerry&gt;</h1>');
    expect(html).toContain('<ul>\n  <li>');
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it('diffs versions line by line', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
    expect(diffLines('a\nb', 'a')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
    ]);
  });
});
