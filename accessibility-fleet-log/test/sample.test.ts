import { describe, expect, it } from 'vitest';
import { buildLog, siteRow } from '../src/core/log';
import { parseFleet, serializeFleet } from '../src/core/model';
import { sampleFleet } from '../src/core/sample';
import { bookmarklet, consoleSnippet } from '../src/core/snippet';
import { importResults } from '../src/core/importers';

describe('demo fleet', () => {
  const f = sampleFleet('2026-11-04');

  it('has six sites with checks dated before today', () => {
    expect(f.sites).toHaveLength(6);
    expect(f.checks.every((c) => c.date <= '2026-11-04')).toBe(true);
    expect(parseFleet(serializeFleet(f))).toEqual(f);
  });

  it('shows the cases the dashboard is for', () => {
    const rows = f.sites.map((s) => siteRow(f, s, '2026-11-04'));
    expect(rows.some((r) => r.due)).toBe(true);
    expect(rows.some((r) => r.statement === 'none')).toBe(true);
    expect(rows.some((r) => r.statement === 'current')).toBe(true);
    expect(rows.some((r) => r.open === 0)).toBe(true);
    const hardware = f.sites.find((s) => s.name === 'Corner Hardware')!;
    expect(buildLog(f, hardware).some((i) => i.events.some((e) => e.kind === 'reopened'))).toBe(true);
  });
});

describe('snippets', () => {
  it('loads a pinned axe-core from cdnjs with a jsDelivr fallback', () => {
    const s = consoleSnippet();
    expect(s).toContain('https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.11.0/axe.min.js');
    expect(s).toContain('https://cdn.jsdelivr.net/npm/axe-core@4.11.0/axe.min.js');
    expect(s).toContain('copy(json)');
    const b = bookmarklet();
    expect(b.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(b.slice(11))).toContain('navigator.clipboard.writeText');
  });

  it('keeps only what the log needs, which the importer reads back', async () => {
    // Run the snippet against a fake axe and capture what it copies.
    let copied = '';
    const fakeAxe = {
      run: async () => ({
        url: 'https://shop.example.com/',
        timestamp: '2026-11-01T00:00:00Z',
        testEngine: { version: '4.11.0' },
        violations: [{ id: 'image-alt', help: 'Alt', impact: 'critical', tags: ['wcag111'], nodes: [{ html: '<img src=secret>', target: ['img'] }] }],
      }),
    };
    const g = globalThis as Record<string, unknown>;
    g.window = { axe: fakeAxe };
    g.axe = fakeAxe;
    g.document = {};
    g.copy = (t: string) => {
      copied = t;
    };
    const log = console.log;
    console.log = () => {};
    try {
      await new Function(`return ${consoleSnippet().replace(/;\s*$/, '')}`)();
    } finally {
      console.log = log;
      delete g.window;
      delete g.axe;
      delete g.copy;
      delete g.document;
    }
    expect(copied).not.toContain('secret');
    const r = importResults(copied);
    expect(r.pages[0].findings[0]).toMatchObject({ ruleId: 'image-alt', criteria: ['1.1.1'], count: 1 });
  });
});
