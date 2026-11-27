import { describe, expect, it } from 'vitest';
import { omittedRows, tickStep, waterfallSvg } from '../src/core/waterfall';
import { makeEntries } from './helpers';

describe('tickStep', () => {
  it('keeps the axis between 4 and 8 gridlines', () => {
    expect(tickStep(80)).toBe(10);
    expect(tickStep(1000)).toBe(200);
    expect(tickStep(6000)).toBe(1000);
    expect(tickStep(600000)).toBe(120000);
  });
});

describe('waterfallSvg', () => {
  it('draws one row per entry with phase segments and tooltips', () => {
    const entries = makeEntries([
      { url: 'https://a.test/', type: 'document', start: 0, time: 100, phases: { dns: 10, connect: 20, wait: 50, receive: 20, send: 0 } },
      { url: 'https://a.test/app.js', type: 'script', start: 100, time: 60, phases: { wait: 40, receive: 19 } },
    ]);
    const svg = waterfallSvg(entries);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect((svg.match(/<title>/g) ?? []).length).toBe(2);
    expect(svg).toContain('/app.js');
    // dns + connect + wait + receive segments for the first row, and each row's type dot.
    for (const cls of ['p-dns', 'p-connect', 'p-wait', 'p-receive', 't-document', 't-script']) expect(svg).toContain(`class="${cls}"`);
    // Colours come from the page's stylesheet, so the waterfall follows the theme.
    expect(svg).not.toMatch(/(?:fill|stroke)="#/);
  });

  it('marks failed requests in red text', () => {
    const entries = makeEntries([{ url: 'https://a.test/api/x', status: 500 }, { url: 'https://a.test/ok' }]);
    const svg = waterfallSvg(entries);
    expect(svg.match(/class="wf-label failed"/g)).toHaveLength(1);
    expect(svg.match(/class="wf-label"/g)).toHaveLength(1);
  });

  it('escapes markup in URLs', () => {
    const entries = makeEntries([{ url: 'https://a.test/p?q=<script>"x"' }]);
    const svg = waterfallSvg(entries);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('filters by type and highlights requested rows', () => {
    const entries = makeEntries([
      { url: 'https://a.test/a.js', type: 'script' },
      { url: 'https://a.test/api/x', type: 'xhr' },
    ]);
    const filtered = waterfallSvg(entries, { types: new Set(['xhr']) });
    expect(filtered).not.toContain('/a.js');
    expect(filtered).toContain('/api/x');
    const highlighted = waterfallSvg(entries, { highlight: new Set([1]) });
    expect(highlighted).toContain('class="wf-hl"');
    expect(filtered).not.toContain('class="wf-hl"');
  });

  it('caps rows and reports the omission count', () => {
    const entries = makeEntries(Array.from({ length: 12 }, (_, i) => ({ url: `https://a.test/r${i}` })));
    const svg = waterfallSvg(entries, { maxRows: 5 });
    expect((svg.match(/<title>/g) ?? []).length).toBe(5);
    expect(omittedRows(entries, { maxRows: 5 })).toBe(7);
    expect(omittedRows(entries, {})).toBe(0);
  });

  it('draws a sliver for zero-duration cached entries', () => {
    const entries = makeEntries([
      { url: 'https://a.test/cached.js', fromCache: true, time: 0, phases: { send: 0, wait: 0, receive: 0 } },
    ]);
    expect(waterfallSvg(entries)).toContain('width="2" height="12" class="p-cached"');
  });
});
