import { describe, expect, it } from 'vitest';
import { parseHar } from '../src/core/har';
import { analyze, leakCount } from '../src/core/analyze';
import { diffReports } from '../src/core/diff';
import { sampleNoChoice, sampleRejected, SAMPLE_SITE } from '../src/core/sample';

const NOW = new Date('2026-11-02T10:00:00Z');

describe('example shop', () => {
  it('last month is clean in both recordings', () => {
    const a = analyze(parseHar(sampleNoChoice(false)), 'no-choice', NOW);
    const b = analyze(parseHar(sampleRejected(false)), 'rejected', NOW);
    expect(a.site).toBe(SAMPLE_SITE);
    expect(leakCount(a)).toBe(0);
    expect(leakCount(b)).toBe(0);
    expect(a.findings.map((f) => f.vendorId).sort()).toEqual(['google-analytics', 'google-fonts', 'google-tag']);
    expect(b.cmp).toMatchObject({ name: 'Complianz', choice: 'rejected' });
  });

  it('today leaks Meta, TikTok and YouTube before choosing, with attributions', () => {
    const r = analyze(parseHar(sampleNoChoice(true)), 'no-choice', NOW);
    const ids = r.findings.filter((f) => f.severity === 'leak').map((f) => f.vendorId);
    expect(ids).toEqual(['meta', 'tiktok', 'youtube']);
    const meta = r.findings.find((f) => f.vendorId === 'meta')!;
    expect(meta.attributions[0]).toMatchObject({ kind: 'plugin', slug: 'facebook-for-woocommerce', version: '3.7.6' });
    expect(meta.evidence.find((e) => e.name === '_fbp')).toMatchObject({ type: 'cookie', setBy: 'script', phase: 'before-choice' });
    const tiktok = r.findings.find((f) => f.vendorId === 'tiktok')!;
    expect(tiktok.attributions[0]).toMatchObject({ kind: 'optimizer', label: 'Autoptimize' });
    const yt = r.findings.find((f) => f.vendorId === 'youtube')!;
    expect(yt.evidence.some((e) => e.name === 'YSC' && e.setBy === 'third-party')).toBe(true);
    expect(r.warnings.some((w) => w.includes('No consent banner'))).toBe(false);
  });

  it('today keeps leaking Meta after Reject all', () => {
    const r = analyze(parseHar(sampleRejected(true)), 'rejected', NOW);
    const meta = r.findings.find((f) => f.vendorId === 'meta')!;
    expect(meta.severity).toBe('leak');
    expect(meta.evidence.every((e) => e.phase === 'after-reject')).toBe(true);
    expect(meta.attributions[0]).toMatchObject({ kind: 'plugin', slug: 'facebook-for-woocommerce' });
    expect(r.warnings).toEqual([]);
  });

  it('the diff names the updated Meta plugin as the suspect', () => {
    const before = analyze(parseHar(sampleNoChoice(false)), 'no-choice', NOW);
    const after = analyze(parseHar(sampleNoChoice(true)), 'no-choice', NOW);
    const d = diffReports(before, after);
    expect(d.newLeaks.map((f) => f.vendorId)).toEqual(['meta', 'tiktok', 'youtube']);
    expect(d.fixedLeaks).toEqual([]);
    expect(d.suspects).toEqual([
      { slug: 'facebook-for-woocommerce', label: 'Meta for WooCommerce', vendor: 'Meta Pixel (Facebook / Instagram)', before: ['3.7.5'], after: ['3.7.6'] },
    ]);
    expect(d.pluginChanges).toHaveLength(1);
  });
});
