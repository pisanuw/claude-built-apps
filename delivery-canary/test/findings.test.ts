import { describe, expect, it } from 'vitest';
import { baselineFrom, bytes, evaluate, SLOW_FAIL_SECONDS, SLOW_WARN_SECONDS, toReport, verdictOf, type EvaluateInput } from '../src/core/findings';
import { emptyResult } from '../src/core/linkcheck';
import type { AuthSummary, Baseline, EmailAnalysis, LinkResult } from '../src/core/types';

const goodAuth: AuthSummary = {
  authServ: 'mx.google.com',
  spf: { method: 'spf', result: 'pass', domain: 'shop.example' },
  dkim: [{ method: 'dkim', result: 'pass', domain: 'shop.example' }],
  dmarc: { method: 'dmarc', result: 'pass', domain: 'shop.example' },
  signedBy: ['shop.example'],
};

function analysis(over: Partial<EmailAnalysis> = {}): EmailAnalysis {
  return {
    from: { name: 'Shop', address: 'hi@shop.example' },
    subject: 'Your download',
    sentAt: '2026-11-12T10:00:00.000Z',
    receivedAt: '2026-11-12T10:00:30.000Z',
    transitSeconds: 20,
    auth: goodAuth,
    links: [{ url: 'https://files.shop.example/download/a.pdf', text: 'Download', score: 11 }],
    app: { id: 'shopify', name: 'Shopify Digital Products', because: 'x' },
    labelPlacement: null,
    listUnsubscribe: false,
    ...over,
  };
}

const file = (over: Partial<LinkResult> = {}): LinkResult => ({
  ...emptyResult('https://files.shop.example/download/a.pdf'),
  status: 200,
  contentType: 'application/pdf',
  fileName: 'a.pdf',
  size: 2048,
  sha256: 'a'.repeat(64),
  ...over,
});

const baseline: Baseline = { fileName: 'a.pdf', contentType: 'application/pdf', size: 2048, sha256: 'a'.repeat(64), host: 'files.shop.example', setAt: '2026-11-01T00:00:00.000Z' };

function ids(input: Partial<EvaluateInput>): string[] {
  return evaluate({ analysis: analysis(), placement: 'inbox', link: file(), baseline, ...input }).map((f) => f.id);
}

describe('evaluate', () => {
  it('passes a clean email with a matching file', () => {
    const findings = evaluate({ analysis: analysis(), placement: 'inbox', link: file(), baseline });
    expect(findings.map((f) => f.id)).toEqual(['placement-inbox', 'spf-pass', 'dkim-pass', 'dmarc-pass', 'fast', 'link-ok', 'baseline-match']);
    expect(verdictOf(findings)).toBe('pass');
  });
  it('flags each placement', () => {
    expect(ids({ placement: 'spam' })).toContain('placement-spam');
    expect(ids({ placement: 'promotions' })).toContain('placement-promotions');
    expect(ids({ placement: 'other' })).toContain('placement-other');
    expect(ids({ placement: 'unknown' })).toContain('placement-unknown');
    expect(verdictOf(evaluate({ analysis: analysis(), placement: 'spam', link: file(), baseline }))).toBe('fail');
  });
  it('reads sender authentication', () => {
    const a = (auth: Partial<AuthSummary> | null) => ids({ analysis: analysis({ auth: auth === null ? null : { ...goodAuth, ...auth } }) });
    expect(a(null)).toContain('auth-missing');
    expect(a({ spf: { method: 'spf', result: 'fail', domain: '' } })).toContain('spf-fail');
    expect(a({ spf: { method: 'spf', result: 'softfail', domain: 'x' } })).toContain('spf-weak');
    expect(a({ spf: null })).not.toContain('spf-pass');
    expect(a({ dkim: [], signedBy: [] })).toContain('dkim-none');
    expect(a({ dkim: [{ method: 'dkim', result: 'fail', domain: 'shop.example' }] })).toContain('dkim-fail');
    expect(a({ dkim: [{ method: 'dkim', result: 'fail', domain: '' }] })).toContain('dkim-fail');
    expect(a({ dkim: [{ method: 'dkim', result: 'pass', domain: 'shopifyemail.com' }] })).toContain('dkim-unaligned');
    expect(a({ dkim: [], signedBy: ['shopifyemail.com'] })).toContain('dkim-unaligned');
    expect(a({ dmarc: { method: 'dmarc', result: 'fail', domain: '' } })).toContain('dmarc-fail');
    expect(a({ dmarc: { method: 'dmarc', result: 'none', domain: '' } })).toContain('dmarc-none');
    expect(a({ dmarc: { method: 'dmarc', result: 'temperror', domain: 'x' } })).toContain('dmarc-other');
    expect(a({ dmarc: null })).not.toContain('dmarc-pass');
  });
  it('fails a free-mailbox sender and does not also call it unaligned', () => {
    const out = ids({ analysis: analysis({ from: { name: '', address: 'shop@gmail.com' }, auth: { ...goodAuth, dkim: [{ method: 'dkim', result: 'pass', domain: 'shopifyemail.com' }] } }) });
    expect(out).toContain('from-free-mailbox');
    expect(out).not.toContain('dkim-unaligned');
  });
  it('does not fail a free-mailbox address that the provider itself signed', () => {
    const gmail = { ...goodAuth, dkim: [{ method: 'dkim' as const, result: 'pass', domain: 'gmail.com' }], dmarc: { method: 'dmarc' as const, result: 'pass', domain: 'gmail.com' } };
    expect(ids({ analysis: analysis({ from: { name: '', address: 'shop@gmail.com' }, auth: gmail }) })).not.toContain('from-free-mailbox');
    expect(ids({ analysis: analysis({ from: { name: '', address: 'shop@gmail.com' }, auth: { ...gmail, dmarc: { method: 'dmarc', result: 'fail', domain: 'gmail.com' } } }) })).toContain('from-free-mailbox');
    expect(ids({ analysis: analysis({ from: { name: '', address: 'shop@gmail.com' }, auth: null }) })).toContain('from-free-mailbox');
  });
  it('rates transit time', () => {
    const t = (transitSeconds: number | null, sentAt = '', receivedAt = '') => ids({ analysis: analysis({ transitSeconds, sentAt, receivedAt }) });
    expect(t(SLOW_WARN_SECONDS)).toContain('slow-warn');
    expect(t(SLOW_FAIL_SECONDS)).toContain('slow-fail');
    expect(t(null)).not.toContain('fast');
    expect(t(null, '2026-11-12T10:00:00Z', '2026-11-12T13:00:00Z')).toContain('slow-fail');
    expect(t(5000)).toContain('slow-warn');
    const fast = evaluate({ analysis: analysis({ transitSeconds: 3, sentAt: '', receivedAt: '' }), placement: 'inbox', link: file(), baseline });
    expect(fast.find((f) => f.id === 'fast')?.detail).toContain('3 seconds');
  });
  it('words long and very long delays', () => {
    const d = (s: number) => evaluate({ analysis: analysis({ transitSeconds: s, sentAt: '', receivedAt: '' }), placement: 'inbox', link: file(), baseline }).find((f) => f.id.startsWith('slow'))?.detail;
    expect(d(1200)).toContain('20 minutes');
    expect(d(3 * 3600)).toContain('3 hours');
  });
  it('checks the links', () => {
    expect(ids({ analysis: analysis({ links: [] }) })).toEqual(expect.arrayContaining(['link-none']));
    expect(ids({ analysis: analysis({ links: [{ url: 'http://files.example/download/a.pdf', text: 'Download', score: 9 }] }) })).toContain('link-http');
    expect(ids({ analysis: analysis({ links: [{ url: 'https://bit.ly/abc', text: 'Download', score: 5 }] }) })).toContain('link-shortener');
    const untested = evaluate({ analysis: analysis(), placement: 'inbox', link: null, linkSkipped: 'Sign in to test', baseline: null });
    expect(untested.find((f) => f.id === 'link-untested')?.detail).toBe('Sign in to test');
    expect(evaluate({ analysis: analysis(), placement: 'inbox', link: null, baseline: null }).find((f) => f.id === 'link-untested')?.detail).toContain('not tested');
  });
  it('reads the link test', () => {
    expect(ids({ link: file({ error: 'boom' }) })).toContain('link-error');
    const status = (s: number) => evaluate({ analysis: analysis(), placement: 'inbox', link: file({ status: s }), baseline }).find((f) => f.id === 'link-status');
    expect(status(404)?.detail).toContain('not found');
    expect(status(403)?.detail).toContain('expired');
    expect(status(500)?.detail).toContain('error');
    expect(ids({ link: file({ page: true, pageSaysExpired: true, pageTitle: 'Expired' }) })).toContain('link-expired');
    expect(ids({ link: file({ page: true, pageSaysExpired: true }) })).toContain('link-expired');
    expect(ids({ link: file({ page: true, pageTitle: 'Your files' }) })).toContain('link-page');
    expect(ids({ link: file({ page: true }) })).toContain('link-page');
    expect(ids({ link: file({ size: 0 }) })).toContain('link-empty');
    expect(ids({ link: file(), baseline: null })).toContain('baseline-none');
    expect(ids({ link: file({ sha256: 'b'.repeat(64) }) })).toContain('baseline-differs');
    const big = evaluate({ analysis: analysis(), placement: 'inbox', link: file({ truncated: true, fileName: '', contentType: '' }), baseline: null });
    expect(big.find((f) => f.id === 'link-ok')?.detail).toContain('first part');
  });
  it('verdict follows the worst finding', () => {
    expect(verdictOf([])).toBe('pass');
    expect(verdictOf([{ id: 'x', severity: 'warn', title: '', detail: '', fix: '' }])).toBe('warn');
  });
});

describe('report and baseline', () => {
  it('saves hosts only, never the download URL', () => {
    const input: EvaluateInput = { analysis: analysis(), placement: 'inbox', link: file({ finalUrl: 'https://cdn.example/a.pdf?token=secret' }), baseline };
    const r = toReport(input, evaluate(input));
    const text = JSON.stringify(r);
    expect(text).not.toContain('token=secret');
    expect(text).not.toContain('/download/a.pdf');
    expect(r.link?.host).toBe('files.shop.example');
    expect(toReport({ ...input, link: file({ url: 'https://Files.Shop.Example/a' }) }, []).link?.host).toBe('files.shop.example');
    expect(r.link?.finalHost).toBe('cdn.example');
    expect(r.analysis.links).toEqual([{ host: 'files.shop.example', text: 'Download' }]);
    expect(toReport({ ...input, link: file({ url: 'nope', finalUrl: 'nope' }) }, []).link?.host).toBe('');
    expect(toReport({ ...input, link: null }, []).link).toBeNull();
  });
  it('makes a baseline only from a good file', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    expect(baselineFrom(file(), now)).toEqual({ fileName: 'a.pdf', contentType: 'application/pdf', size: 2048, sha256: 'a'.repeat(64), host: 'files.shop.example', setAt: '2026-11-12T00:00:00.000Z' });
    expect(baselineFrom(file({ error: 'x' }))).toBeNull();
    expect(baselineFrom(file({ page: true }))).toBeNull();
    expect(baselineFrom(file({ status: 404 }))).toBeNull();
    expect(baselineFrom(file({ size: 0 }))).toBeNull();
    expect(baselineFrom(file())?.setAt).toMatch(/^\d{4}-/);
  });
  it('formats sizes', () => {
    expect(bytes(10)).toBe('10 bytes');
    expect(bytes(2048)).toBe('2.0 KB');
    expect(bytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
