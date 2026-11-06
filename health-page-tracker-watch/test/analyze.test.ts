import { describe, expect, it } from 'vitest';
import type { Profile } from '../src/core/analyze';
import { analyze, context, domainKey, verdict } from '../src/core/analyze';
import type { Capture } from '../src/core/capture';
import { parseHar } from '../src/core/capture';
import { sampleHar } from '../src/core/sample';

const NOW = new Date('2026-11-06T12:00:00Z');
const HIPAA: Profile = { practice: 'hipaa', states: [] };

function cap(pages: Array<[string, string[], boolean?]>): Capture {
  return { site: 'clinic.test', pages: pages.map(([url, reqs, sent]) => ({ url, title: '', source: 'recording', requests: reqs.map((u) => ({ url: u, host: new URL(u).hostname, sentPageAddress: Boolean(sent) })) })) };
}

describe('analyze', () => {
  it('rates the example practice', () => {
    const r = analyze(parseHar(sampleHar(true)), { practice: 'hipaa', states: ['WA'] }, {}, NOW);
    expect(r.site).toBe('harborview-counseling.example');
    expect(r.generatedAt).toBe(NOW.toISOString());
    expect(r.healthPageCount).toBe(3);
    const review = r.tools.filter((t) => t.level === 'review').map((t) => t.key);
    expect(review).toEqual(expect.arrayContaining(['meta-pixel', 'google-analytics', 'hotjar', 'tawk', 'userway']));
    expect(r.tools.find((t) => t.key === 'jane')?.level).toBe('ok');
    expect(r.tools.find((t) => t.key === 'jotform')?.level).toBe('check');
    expect(r.tools.find((t) => t.key === 'google-maps')?.level).toBe('fyi');
    expect(r.tools.find((t) => t.key === 'host:badgeworks.example')?.level).toBe('check');
    const meta = r.tools.find((t) => t.key === 'meta-pixel');
    expect(meta?.why.join(' ')).toMatch(/full page address/);
    expect(meta?.why.join(' ')).toMatch(/Washington/);
    expect(meta?.why.join(' ')).toMatch(/does not sign a BAA/);
    expect(r.tools.find((t) => t.key === 'tawk')?.why.join(' ')).toMatch(/could not confirm/);
    expect(verdict(r)).toBe(`${r.counts.review} tools on your health pages to review now.`);
    expect(r.warnings).toEqual([]);
    // Review first, ok last.
    expect(r.tools[0].level).toBe('review');
    expect(r.tools[r.tools.length - 1].level).toBe('ok');
  });

  it('follows the owner’s page kinds', () => {
    const c = cap([['https://clinic.test/about', ['https://connect.facebook.net/fbevents.js']]]);
    const before = analyze(c, HIPAA, {}, NOW);
    expect(before.tools[0].level).toBe('fyi');
    expect(before.warnings[0]).toMatch(/None of these pages/);
    expect(verdict(before)).toBe('No health pages in this check yet.');
    const after = analyze(c, HIPAA, { 'https://clinic.test/about': 'service' }, NOW);
    expect(after.tools[0].level).toBe('review');
    expect(verdict({ ...after, counts: { review: 1, check: 0, ok: 0, fyi: 0 } })).toBe('1 tool on your health pages to review now.');
  });

  it('gives confirm and all-clear verdicts', () => {
    const c = cap([['https://clinic.test/book', ['https://fonts.googleapis.com/css', 'https://acuityscheduling.com/embed.js']]]);
    const r = analyze(c, HIPAA, {}, NOW);
    expect(r.counts).toEqual({ review: 0, check: 2, ok: 0, fyi: 0 });
    expect(verdict(r)).toBe('Nothing urgent, but 2 things on your health pages to confirm.');
    expect(r.tools.find((t) => t.key === 'acuity')?.why.join(' ')).toMatch(/some plans/);
    const one = analyze(cap([['https://clinic.test/book', ['https://fonts.googleapis.com/css']]]), HIPAA, {}, NOW);
    expect(verdict(one)).toBe('Nothing urgent, but 1 thing on your health pages to confirm.');
    const clean = analyze(cap([['https://clinic.test/book', ['https://x.janeapp.com/a']]]), HIPAA, {}, NOW);
    expect(verdict(clean)).toBe('No outside tool on your health pages needs attention.');
  });

  it('words review findings for wellness businesses without BAA talk', () => {
    const r = analyze(cap([['https://clinic.test/book', ['https://static.hotjar.com/c.js'], true]]), { practice: 'wellness', states: ['NV', 'CT'] }, {}, NOW);
    const why = r.tools[0].why.join(' ');
    expect(why).not.toMatch(/BAA/);
    expect(why).toMatch(/Nevada, Connecticut/);
    expect(why).toMatch(/full page address \(for example \/book\)/);
  });

  it('flags a page-source-only check', () => {
    const c: Capture = { site: 'clinic.test', pages: [{ url: 'https://clinic.test/book', title: '', source: 'page-source', requests: [] }] };
    expect(analyze(c, HIPAA, {}, NOW).warnings.join(' ')).toMatch(/page source only/);
  });

  it('groups unknown hosts by domain', () => {
    expect(domainKey('a.b.widgets.test')).toBe('widgets.test');
    expect(domainKey('cdn.shop.co.uk')).toBe('shop.co.uk');
    expect(domainKey('localhost')).toBe('localhost');
    const r = analyze(cap([['https://clinic.test/', ['https://a.widgets.test/1', 'https://b.widgets.test/2']]]), HIPAA, {}, NOW);
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0].hosts).toEqual(['a.widgets.test', 'b.widgets.test']);
    expect(r.tools[0].level).toBe('fyi');
    expect(r.pages[0].tools).toEqual(['host:widgets.test']);
  });

  it('explains what the levels mean for each practice type', () => {
    expect(context({ practice: 'hipaa', states: [] })).toMatch(/^If you are covered by HIPAA/);
    expect(context({ practice: 'wellness', states: [] })).toMatch(/^If HIPAA does not cover you/);
    expect(context({ practice: 'unsure', states: [] })).toMatch(/HIPAA.*HIPAA does not cover/);
  });
});
