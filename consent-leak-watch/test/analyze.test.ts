import { describe, expect, it } from 'vitest';
import { analyze, consentModeState, leakCount, modeLabel } from '../src/core/analyze';
import { parseHar } from '../src/core/har';
import { makeHar } from './helpers';

const NOW = new Date('2026-11-02T00:00:00Z');

describe('consentModeState', () => {
  it('reads gcs', () => {
    expect(consentModeState('https://x/collect?gcs=G101')).toEqual({ ad: false, analytics: true });
    expect(consentModeState('https://x/collect?gcs=bad')).toBeNull();
    expect(consentModeState('https://x/collect')).toBeNull();
    expect(consentModeState('nope')).toBeNull();
  });
});

describe('analyze', () => {
  it('treats Consent Mode pings by the granted flags', () => {
    const r = analyze(
      parseHar(
        makeHar([
          { url: 'https://s.com/', type: 'document' },
          { url: 'https://www.google-analytics.com/g/collect?gcs=G111' },
          { url: 'https://www.googleadservices.com/pagead/conversion?gcs=G100' },
        ]),
      ),
      'no-choice',
      NOW,
    );
    const ga = r.findings.find((f) => f.vendorId === 'google-analytics')!;
    expect(ga.severity).toBe('leak');
    expect(ga.evidence[0].note).toMatch(/granted/);
    expect(r.findings.find((f) => f.vendorId === 'google-ads')!.severity).toBe('notice');
    expect(modeLabel('rejected')).toBe('after Reject all');
  });

  it('warns about sanitized, unfresh and unrecognised recordings, and lists unknown cookies', () => {
    const r = analyze(parseHar(makeHar([{ url: 'https://s.com/', type: 'document', cookie: '_ga=1; old=2' }, { url: 'https://s.com/x', cookie: '_ga=1; old=2; newone=3; PHPSESSID=1' }])), 'no-choice', NOW);
    expect(r.preexistingCookies).toEqual(['_ga', 'old']);
    expect(r.unclassifiedCookies).toEqual(['newone']);
    expect(leakCount(r)).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/not a fresh visit/);
    expect(r.warnings.join(' ')).toMatch(/No consent banner/);

    const many = analyze(parseHar(makeHar([{ url: 'https://s.com/', type: 'document', cookie: 'a=1;b=1;c=1;d=1;e=1;f=1;g=1' }])), 'no-choice', NOW);
    expect(many.warnings.join(' ')).toMatch(/…/);

    const s = analyze(parseHar(makeHar([{ url: 'https://s.com/', type: 'document' }])), 'rejected', NOW);
    expect(s.warnings.join(' ')).toMatch(/no cookies in it/);
  });

  it('handles accepted choices and missing reject', () => {
    const accepted = analyze(
      parseHar(
        makeHar([
          { url: 'https://s.com/', type: 'document' },
          { url: 'https://s.com/a', cookie: 'cmplz_marketing=allow; cmplz_statistics=allow' },
          { url: 'https://connect.facebook.net/en_US/fbevents.js' },
        ]),
      ),
      'rejected',
      NOW,
    );
    expect(accepted.warnings.join(' ')).toMatch(/accepted/);
    expect(leakCount(accepted)).toBe(0);

    const custom = analyze(parseHar(makeHar([{ url: 'https://s.com/', type: 'document' }, { url: 'https://s.com/a', cookie: 'cmplz_marketing=allow; cmplz_statistics=deny' }])), 'rejected', NOW);
    expect(custom.warnings.join(' ')).toMatch(/custom choice/);

    const noReject = analyze(parseHar(makeHar([{ url: 'https://s.com/', type: 'document' }, { url: 'https://s.com/wp-content/plugins/complianz-gdpr/a.js', cookie: 'x=1' }])), 'rejected', NOW);
    expect(noReject.warnings.join(' ')).toMatch(/No Reject all choice/);

    const clicked = analyze(
      parseHar(makeHar([{ url: 'https://s.com/', type: 'document' }, { url: 'https://s.com/a', cookie: 'cmplz_marketing=deny; cmplz_statistics=deny' }, { url: 'https://connect.facebook.net/x.js' }])),
      'no-choice',
      NOW,
    );
    expect(clicked.warnings.join(' ')).toMatch(/choice was made during/);
    expect(leakCount(clicked)).toBe(0);
  });

  it('attributes server-set cookies and falls back to unknown', () => {
    const r = analyze(
      parseHar(
        makeHar([
          { url: 'https://s.com/', type: 'document', setCookie: ['_fbp=1'] },
          { url: 'https://s.com/wp-content/plugins/pys/ajax.php', setCookie: ['_ga=1'] },
          { url: 'https://s.com/x', cookie: '_fbp=1; _ga=1; _hjSession=1' },
          { url: 'https://cdn.example/x', setCookie: ['_hjSession=1'] },
        ]),
      ),
      'no-choice',
      NOW,
    );
    const meta = r.findings.find((f) => f.vendorId === 'meta')!;
    expect(meta.attributions[0].kind).toBe('server');
    const ga = r.findings.find((f) => f.vendorId === 'google-analytics')!;
    expect(ga.attributions[0]).toMatchObject({ kind: 'plugin', slug: 'pys' });
    const hj = r.findings.find((f) => f.vendorId === 'hotjar')!;
    expect(hj.evidence[0].setBy).toBe('third-party');
    expect(hj.attributions[0]).toEqual({ kind: 'unknown', evidence: 'no script path recorded' });
    expect(r.findings.map((f) => f.purpose)).toEqual(['marketing', 'analytics', 'analytics']);
  });

  it('copes with a recording with no timestamps', () => {
    const r = analyze(parseHar(JSON.stringify({ log: { entries: [{ request: { url: 'https://s.com/' } }] } })), 'no-choice', NOW);
    expect(r.recordedAt).toBe('');
    expect(r.pages).toEqual([]);
  });
});
