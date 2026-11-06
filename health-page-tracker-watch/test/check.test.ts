import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { parseHar } from '../src/core/capture';
import { diffChecks, hasChanges, loadCheck, saveCheck, tableUpdatesSince, toSaved } from '../src/core/check';
import { sampleHar } from '../src/core/sample';

const P = { practice: 'hipaa' as const, states: [] };

describe('saved checks', () => {
  const last = analyze(parseHar(sampleHar(false)), P, {}, new Date('2026-10-06T00:00:00Z'));
  const now = analyze(parseHar(sampleHar(true)), P, {}, new Date('2026-11-06T00:00:00Z'));

  it('round-trips', () => {
    const saved = loadCheck(saveCheck(last));
    expect(saved.site).toBe('harborview-counseling.example');
    expect(saved.pages).toHaveLength(5);
    expect(saved.tools.find((t) => t.key === 'meta-pixel')?.healthPages).toEqual(['https://www.harborview-counseling.example/services/anxiety-therapy']);
  });

  it('rejects other files', () => {
    expect(() => loadCheck('x')).toThrow(/not valid JSON/);
    expect(() => loadCheck('{"app":"other"}')).toThrow(/not a check saved/);
    expect(() => loadCheck('null')).toThrow(/not a check saved/);
  });

  it('shows what changed since last month', () => {
    const d = diffChecks(toSaved(last), now);
    expect(d.previousDate).toBe('2026-10-06');
    expect(d.sameSite).toBe(true);
    expect(d.newTools.map((t) => t.key)).toEqual(['hotjar']);
    expect(d.newTools[0].healthPages).toHaveLength(3);
    expect(d.spread).toEqual([{ key: 'meta-pixel', name: 'Meta Pixel (Facebook / Instagram)', newHealthPages: ['https://www.harborview-counseling.example/book'] }]);
    expect(d.goneTools).toEqual([]);
    expect(d.notRechecked).toEqual([]);
    expect(hasChanges(d)).toBe(true);
    expect(hasChanges(diffChecks(toSaved(now), now))).toBe(false);
  });

  it('reports gone tools only for pages checked again, and worse levels and BAA changes', () => {
    const prev = toSaved(now);
    prev.site = 'other.example';
    prev.tools.push({ key: 'host:gone.test', name: 'gone.test', level: 'check', baa: null, pages: [now.pages[0].url], healthPages: [] });
    prev.tools.push({ key: 'host:elsewhere.test', name: 'elsewhere.test', level: 'check', baa: null, pages: ['https://www.harborview-counseling.example/old'], healthPages: [] });
    prev.pages.push({ url: 'https://www.harborview-counseling.example/old', kind: 'other' });
    const meta = prev.tools.find((t) => t.key === 'meta-pixel');
    if (meta) {
      meta.level = 'fyi';
      meta.baa = 'ask';
    }
    const d = diffChecks(prev, now);
    expect(d.sameSite).toBe(false);
    expect(d.goneTools.map((t) => t.key)).toEqual(['host:gone.test']);
    expect(d.notRechecked).toEqual(['https://www.harborview-counseling.example/old']);
    expect(d.worse).toEqual([{ key: 'meta-pixel', name: 'Meta Pixel (Facebook / Instagram)', before: 'fyi', after: 'review' }]);
    expect(d.baaChanged[0]).toMatchObject({ key: 'meta-pixel', before: 'ask', after: 'no' });
    expect(tableUpdatesSince(prev)).toEqual([{ name: 'Meta Pixel (Facebook / Instagram)', before: 'ask', after: 'no' }]);
  });
});
