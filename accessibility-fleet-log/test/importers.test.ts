import { describe, expect, it } from 'vitest';
import { csvHeaders, foreignPages, guessCsvMapping, importResults, matchSite, readImpact } from '../src/core/importers';
import { fleet, site } from './helpers';

const axe = (url: string, violations: unknown[], extra: Record<string, unknown> = {}) => ({ url, timestamp: '2026-10-29T10:00:00.000Z', testEngine: { version: '4.11.0' }, violations, ...extra });

describe('axe-core import', () => {
  it('reads a single result with tags, nodes and needs-review notes', () => {
    const r = importResults(
      JSON.stringify(
        axe('https://shop.example.com/menu/', [
          { id: 'color-contrast', help: 'Contrast', impact: 'serious', tags: ['wcag2aa', 'wcag143'], nodes: [{}, {}, {}] },
          { id: 'region', help: 'Landmarks', impact: 'moderate', tags: ['best-practice'], nodes: [{}] },
          { id: 'label', help: 'Labels', impact: 'critical', nodes: [] },
          { help: 'no id' },
        ], { incomplete: [{ id: 'x' }, { id: 'y' }] }),
      ),
    );
    expect(r).toMatchObject({ format: 'axe', engine: 'axe-core 4.11.0', date: '2026-10-29' });
    expect(r.pages).toEqual([
      {
        url: 'https://shop.example.com/menu',
        findings: [
          { ruleId: 'color-contrast', help: 'Contrast', criteria: ['1.4.3'], impact: 'serious', count: 3 },
          { ruleId: 'region', help: 'Landmarks', criteria: [], impact: 'moderate', count: 1 },
          { ruleId: 'label', help: 'Labels', criteria: ['4.1.2'], impact: 'critical', count: 1 },
        ],
      },
    ]);
    expect(r.notes[0]).toMatch(/2 "needs review" results/);
  });

  it('reads @axe-core/cli arrays, merging repeats of a page', () => {
    const r = importResults(
      JSON.stringify([
        axe('https://shop.example.com/', [{ id: 'image-alt', tags: ['wcag111'], nodes: [{}] }], { testEngine: {} }),
        axe('https://shop.example.com/', [{ id: 'image-alt', tags: ['wcag111'], nodes: [{}, {}] }]),
        axe('https://shop.example.com/contact', []),
      ]),
    );
    expect(r.engine).toBe('axe-core 4.11.0');
    expect(r.pages.map((p) => [p.url, p.findings.map((f) => f.count)])).toEqual([
      ['https://shop.example.com/', [3]],
      ['https://shop.example.com/contact', []],
    ]);
  });

  it('needs a page address when axe results lack one', () => {
    const noUrl = JSON.stringify({ violations: [] });
    expect(() => importResults(noUrl)).toThrow(/which page/);
    const r = importResults(noUrl, { pageUrl: 'https://shop.example.com/x' });
    expect(r).toMatchObject({ engine: 'axe-core', date: null });
    expect(r.pages[0].url).toBe('https://shop.example.com/x');
    expect(() => importResults(JSON.stringify([axe('https://a/', []), { nope: 1 }]))).toThrow(/Item 2/);
  });
});

describe('pa11y import', () => {
  const issues = [
    { code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', type: 'error', message: 'This element has insufficient contrast.\nMore', selector: 'p' },
    { code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', type: 'error', message: 'Again' },
    { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'warning', message: 'Check alt' },
    { code: 'image-alt', type: 'error', runner: 'axe', message: 'Images must have alt' },
    { code: 'mystery', message: 'No type' },
    { type: 'error' },
  ];

  it('reads plain pa11y JSON with a page address', () => {
    expect(() => importResults(JSON.stringify(issues))).toThrow(/which page/);
    const r = importResults(JSON.stringify(issues), { pageUrl: 'https://shop.example.com/' });
    expect(r.format).toBe('pa11y');
    expect(r.pages[0].findings).toEqual([
      { ruleId: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', help: 'This element has insufficient contrast.', criteria: ['1.4.3'], impact: 'serious', count: 2 },
      { ruleId: 'image-alt', help: 'Images must have alt', criteria: ['1.1.1'], impact: 'serious', count: 1 },
      { ruleId: 'mystery', help: 'No type', criteria: [], impact: 'serious', count: 1 },
    ]);
    expect(r.notes[0]).toMatch(/1 warning and notice left out/);
    expect(importResults('[]', { pageUrl: 'https://shop.example.com/' }).pages).toEqual([{ url: 'https://shop.example.com/', findings: [] }]);
  });

  it('reads pa11y-ci output and skips pages that failed to load', () => {
    const r = importResults(
      JSON.stringify({
        total: 3,
        results: {
          'https://shop.example.com/': issues.slice(0, 3),
          'https://shop.example.com/broken': [{ message: 'timed out' }],
          'https://shop.example.com/ok': [],
          'https://shop.example.com/odd': 'nope',
        },
      }),
    );
    expect(r).toMatchObject({ format: 'pa11y-ci', engine: 'pa11y-ci' });
    expect(r.pages.map((p) => [p.url, p.findings.length])).toEqual([
      ['https://shop.example.com/', 1],
      ['https://shop.example.com/ok', 0],
    ]);
    expect(r.notes[0]).toMatch(/1 warning/);
  });
});

describe('Lighthouse import', () => {
  const lhr = {
    lighthouseVersion: '12.2.1',
    finalDisplayedUrl: 'https://shop.example.com/',
    fetchTime: '2026-10-20T08:00:00.000Z',
    categories: { accessibility: { auditRefs: [{ id: 'color-contrast' }, { id: 'image-alt' }, { id: 'document-title' }, { id: 'ghost' }] } },
    audits: {
      'color-contrast': { title: 'Background and foreground colors do not have a sufficient contrast ratio.', score: 0, scoreDisplayMode: 'binary', details: { items: [{}, {}] } },
      'image-alt': { title: 'Image elements do not have [alt] attributes', score: 0, scoreDisplayMode: 'binary' },
      'document-title': { title: 'ok', score: 1, scoreDisplayMode: 'binary' },
    },
  };

  it('keeps failed binary accessibility audits', () => {
    const r = importResults(JSON.stringify(lhr));
    expect(r).toMatchObject({ format: 'lighthouse', engine: 'Lighthouse 12.2.1', date: '2026-10-20' });
    expect(r.pages[0].findings.map((f) => [f.ruleId, f.count, f.criteria])).toEqual([
      ['color-contrast', 2, ['1.4.3']],
      ['image-alt', 1, ['1.1.1']],
    ]);
  });

  it('falls back to known audit ids and other address fields', () => {
    const r = importResults(JSON.stringify({ requestedUrl: 'https://shop.example.com/a', audits: lhr.audits }));
    expect(r.engine).toBe('Lighthouse');
    expect(r.pages[0].findings).toHaveLength(2);
    expect(() => importResults(JSON.stringify({ audits: lhr.audits }))).toThrow(/which page/);
    expect(() => importResults(JSON.stringify({ finalUrl: 'https://x/', audits: { 'first-contentful-paint': {} } }))).toThrow(/no accessibility results/);
  });
});

describe('CSV import', () => {
  it('guesses columns', () => {
    const headers = ['Page URL', 'Rule ID', 'Description', 'WCAG Success Criterion', 'Severity', 'Instances', 'Status'];
    expect(guessCsvMapping(headers)).toEqual({ url: 0, rule: 1, help: 2, criteria: 3, impact: 4, count: 5, status: 6 });
    expect(guessCsvMapping(['foo'])).toMatchObject({ url: -1, rule: -1 });
    expect(csvHeaders('a,b\n1,2')).toEqual(['a', 'b']);
    expect(csvHeaders('')).toEqual([]);
  });

  it('aggregates rows by page and rule, skipping closed rows', () => {
    const csv = [
      'Page,Issue,Description,WCAG,Severity,Count,Status',
      'https://shop.example.com/,image-alt,Missing alt,,High,3,Open',
      'https://shop.example.com/,image-alt,Missing alt,,,2,',
      'https://shop.example.com/,Low contrast text in footer area and also elsewhere on the page,,WCAG 1.4.3,Medium,,',
      'https://shop.example.com/about,label,,,,,Ignored',
      ',label,,,,,',
      'https://shop.example.com/x,,,,,,',
    ].join('\n');
    const r = importResults(csv);
    expect(r.format).toBe('csv');
    expect(r.pages).toEqual([
      {
        url: 'https://shop.example.com/',
        findings: [
          { ruleId: 'image-alt', help: 'Missing alt', criteria: ['1.1.1'], impact: 'serious', count: 5 },
          { ruleId: 'low-contrast-text-in-footer-area-and-also-elsewhere-on-the-p', help: 'Low contrast text in footer area and also elsewhere on the page', criteria: ['1.4.3'], impact: 'moderate', count: 1 },
        ],
      },
      { url: 'https://shop.example.com/about', findings: [] },
      { url: 'https://shop.example.com/x', findings: [] },
    ]);
    expect(r.notes[0]).toMatch(/1 row marked ignored/);
  });

  it('uses the page address option and an explicit mapping', () => {
    const r = importResults('Problem,Ref\nSkip link missing 2.4.1,x', { pageUrl: 'https://shop.example.com/' });
    expect(r.pages[0].findings[0]).toMatchObject({ ruleId: 'Skip link missing 2.4.1', criteria: ['2.4.1'] });
    const m = importResults('a,b\nhttps://s.example/,label', { csvMapping: { url: 0, rule: 1, help: -1, criteria: -1, impact: -1, count: -1, status: -1 } });
    expect(m.pages[0].findings[0]).toMatchObject({ ruleId: 'label', criteria: ['4.1.2'] });
  });

  it('explains what is missing', () => {
    expect(() => importResults('rule\nlabel')).toThrow(/page addresses/);
    expect(() => importResults('page\nhttps://x/')).toThrow(/column with the issue/);
    expect(() => importResults('   ')).toThrow(/empty/);
    expect(() => importResults('{nope')).toThrow(/cannot be read/);
    expect(() => importResults('{"a":1}')).toThrow(/not from a checker/);
  });

  it('reads impact words', () => {
    expect(['Critical', 'error', 'warning', 'notice', 'weird', 3].map(readImpact)).toEqual(['critical', 'serious', 'moderate', 'minor', null, null]);
  });
});

describe('site matching', () => {
  it('picks the site most pages belong to and lists strangers', () => {
    const f = fleet([site('a', { url: 'https://www.shop.example.com' }), site('b', { url: 'https://cafe.example.com' }), site('c', { url: '' })]);
    const pages = [
      { url: 'https://cafe.example.com/', findings: [] },
      { url: 'https://cafe.example.com/menu', findings: [] },
      { url: 'https://shop.example.com/', findings: [] },
    ];
    expect(matchSite(f, pages)).toBe('b');
    expect(matchSite(f, [{ url: 'https://other.example/', findings: [] }])).toBeNull();
    expect(foreignPages('https://cafe.example.com', pages)).toEqual(['https://shop.example.com/']);
    expect(foreignPages('', pages)).toEqual([]);
  });
});
