import { describe, expect, it } from 'vitest';
import type { Finding, ScanReport } from '../src/core/analyze';
import { analyze } from '../src/core/analyze';
import { diffReports } from '../src/core/diff';
import { parseHar } from '../src/core/har';
import { advice, describeAttribution, loadCheck, saveCheck, toMarkdown, verdict } from '../src/core/report';
import { sampleNoChoice, sampleRejected } from '../src/core/sample';

const NOW = new Date('2026-11-02T00:00:00Z');
const before = analyze(parseHar(sampleNoChoice(false)), 'no-choice', NOW);
const after = analyze(parseHar(sampleNoChoice(true)), 'no-choice', NOW);
const rejected = analyze(parseHar(sampleRejected(true)), 'rejected', NOW);

const f = (over: Partial<Finding>): Finding => ({ vendorId: 'x', vendor: 'X', purpose: 'marketing', what: '', severity: 'leak', evidence: [], attributions: [], ...over });

describe('words', () => {
  it('describes every attribution kind', () => {
    expect(describeAttribution({ kind: 'plugin', label: 'P', version: '1', evidence: '' })).toBe('Loaded by the plugin P 1.');
    expect(describeAttribution({ kind: 'plugin', slug: 'p', evidence: '' })).toBe('Loaded by the plugin p.');
    expect(describeAttribution({ kind: 'theme', slug: 't', evidence: '' })).toMatch(/theme t/);
    expect(describeAttribution({ kind: 'inline', slug: 'h', evidence: '' })).toMatch(/handle “h”/);
    expect(describeAttribution({ kind: 'inline', evidence: '' })).toMatch(/no id/);
    expect(describeAttribution({ kind: 'inline', element: 'iframe', evidence: '' })).toMatch(/iframe/);
    expect(describeAttribution({ kind: 'optimizer', label: 'WP Rocket', evidence: '' })).toMatch(/WP Rocket/);
    expect(describeAttribution({ kind: 'server', evidence: '' })).toMatch(/server/);
    expect(describeAttribution({ kind: 'unknown', evidence: '' })).toMatch(/Cannot name/);
  });
  it('gives advice per case', () => {
    expect(advice(f({ severity: 'notice', vendorId: 'google-fonts' }))).toMatch(/Host the fonts/);
    expect(advice(f({ severity: 'notice' }))).toMatch(/Not a leak/);
    expect(advice(f({ purpose: 'embed' }))).toMatch(/placeholder/);
    expect(advice(f({ attributions: [{ kind: 'plugin', slug: 'p', evidence: '' }] }))).toMatch(/In p,.*in use/);
    expect(advice(f({ attributions: [{ kind: 'optimizer', label: 'Breeze', evidence: '' }] }))).toMatch(/Breeze/);
    expect(advice(f({ attributions: [{ kind: 'server', evidence: '' }] }))).toMatch(/PHP/);
    expect(advice(f({}))).toMatch(/Google Tag Manager/);
  });
  it('writes verdicts', () => {
    expect(verdict(before)).toMatch(/^No tracking found before choosing on the 2 page/);
    expect(verdict(after)).toBe('3 trackers fired before choosing.');
    expect(verdict(rejected)).toBe('1 tracker fired after Reject all.');
    expect(verdict({ ...before, pages: [] })).toMatch(/on the 1 page/);
  });
});

describe('markdown and saving', () => {
  it('renders a summary with the diff', () => {
    const md = toMarkdown([after, rejected], [diffReports(before, after)]);
    expect(md).toContain('# Consent check: fernhill-candles.example');
    expect(md).toContain('### LEAK: Meta Pixel');
    expect(md).toContain('cookie `_fbp` (set by script)');
    expect(md).toContain('Suspect: Meta for WooCommerce changed 3.7.5 -> 3.7.6');
    expect(md).toContain('Banner: Complianz, stored choice: rejected.');
    expect(md).toContain('not legal advice');
    const bare = toMarkdown([{ ...before, recordedAt: '', warnings: ['w'], cmp: { name: '', choice: 'unknown', choiceIndex: -1 } }]);
    expect(bare).toContain('at an unknown time');
    expect(bare).toContain('- w');
    expect(bare).toContain('### Note: Google Fonts');
  });
  it('round-trips a saved check and rejects other files', () => {
    const text = saveCheck([after], NOW);
    expect(loadCheck(text).reports[0].site).toBe('fernhill-candles.example');
    expect(() => loadCheck('x')).toThrow(/not JSON/);
    expect(() => loadCheck('{"log":{}}')).toThrow(/HAR recording/);
    expect(() => loadCheck('{"app":"other"}')).toThrow(/not a saved/);
    expect(() => loadCheck('null')).toThrow(/not a saved/);
  });
});

describe('diffReports', () => {
  it('finds fixed leaks, new evidence, added and removed plugins', () => {
    const plugins = (list: ScanReport['plugins']): ScanReport => ({ ...after, plugins: list });
    const a = plugins([{ slug: 'old', label: 'Old', kind: 'plugin', versions: ['1'] }, ...after.plugins]);
    const metaMore: ScanReport = {
      ...after,
      findings: after.findings.map((x) => (x.vendorId === 'meta' ? { ...x, evidence: [...x.evidence, { type: 'cookie', name: '_fbc', firstUrl: '', page: '', phase: 'before-choice', count: 1, leak: true }] } : x)),
      plugins: [...after.plugins.filter((p) => p.slug !== 'facebook-for-woocommerce'), { slug: 'facebook-for-woocommerce', label: 'Meta for WooCommerce', kind: 'plugin', versions: ['3.8'] }, { slug: 'new', label: 'New', kind: 'plugin', versions: [] }],
    };
    const d = diffReports(a, metaMore);
    expect(d.newLeaks).toEqual([]);
    expect(d.newEvidence).toEqual([{ vendor: 'Meta Pixel (Facebook / Instagram)', names: ['_fbc'] }]);
    expect(d.pluginChanges.map((c) => `${c.label}:${c.change}`)).toEqual(['Meta for WooCommerce:updated', 'New:added', 'Old:removed']);
    expect(d.suspects.map((s) => s.slug)).toEqual(['facebook-for-woocommerce']);

    const fixed = diffReports(after, before);
    expect(fixed.fixedLeaks.map((x) => x.vendorId)).toEqual(['meta', 'tiktok', 'youtube']);
    expect(diffReports(before, rejected)).toMatchObject({ sameMode: false, sameSite: true });
  });
});
