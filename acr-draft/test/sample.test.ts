import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/conformance';
import { samplePrevious, sampleProject } from '../src/core/sample';
import { CRITERIA_BY_ID } from '../src/core/wcag';

describe('example project', () => {
  it('is partly reviewed and shows each kind of finding', () => {
    const p = sampleProject();
    for (const s of p.screens) for (const r of s.scan!.rules) for (const c of r.criteria) expect(CRITERIA_BY_ID.has(c)).toBe(true);
    const ev = evaluate(p);
    const kinds = new Set(ev.results.flatMap((r) => r.warnings.map((w) => w.kind)));
    expect([...kinds].sort()).toEqual(['conflict', 'not-evaluated', 'review', 'scan-only']);
    expect(ev.counts.A.Supports + ev.counts.AA.Supports).toBeGreaterThan(5);
  });

  it('has an earlier release that differs', () => {
    const a = samplePrevious();
    expect(a.product.version).toBe('4.1');
    expect(a.screens).toHaveLength(3);
    expect(sampleProject().screens).toHaveLength(4);
  });
});
