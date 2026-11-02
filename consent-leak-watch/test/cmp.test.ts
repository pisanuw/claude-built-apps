import { describe, expect, it } from 'vitest';
import { detectCmp } from '../src/core/cmp';
import { parseHar } from '../src/core/har';
import { makeHar } from './helpers';

const run = (cookie: string, url = 'https://s.com/page') =>
  detectCmp(parseHar(makeHar([{ url: 'https://s.com/', type: 'document' }, { url, cookie }])));

describe('detectCmp', () => {
  it('reads Complianz choices', () => {
    expect(run('cmplz_marketing=deny; cmplz_statistics=deny')).toEqual({ name: 'Complianz', choice: 'rejected', choiceIndex: 1 });
    expect(run('cmplz_marketing=allow; cmplz_statistics=allow').choice).toBe('accepted');
    expect(run('cmplz_marketing=allow; cmplz_statistics=deny').choice).toBe('custom');
    expect(run('cmplz_banner-status=dismissed').choice).toBe('unknown');
  });
  it('reads CookieYes', () => {
    expect(run('cookieyes-consent=' + encodeURIComponent('consentid:1,consent:no,action:yes,necessary:yes,analytics:no,advertisement:no')).choice).toBe('rejected');
    expect(run('cookieyes-consent=consentid:1,action:,analytics:no')).toMatchObject({ name: 'CookieYes', choice: 'none', choiceIndex: -1 });
  });
  it('reads Cookiebot', () => {
    expect(run("CookieConsent={stamp:'x',necessary:true,statistics:false,marketing:false}").choice).toBe('rejected');
    expect(run('CookieConsent=-1').choice).toBe('unknown');
    expect(run('CookieConsent=%E0%A4%A').choice).toBe('unknown');
  });
  it('reads OneTrust', () => {
    const groups = encodeURIComponent('C0001:1,C0002:0,C0004:0');
    expect(run(`OptanonConsent=isGpcEnabled=0&groups=${groups}; OptanonAlertBoxClosed=2026`).choice).toBe('rejected');
    expect(run(`OptanonConsent=groups=${groups}`).choice).toBe('none');
    expect(run('OptanonConsent=x=1').choice).toBe('unknown');
  });
  it('reads Borlabs and Real Cookie Banner', () => {
    expect(run('borlabs-cookie=' + encodeURIComponent('{"consents":{"essential":["x"]}}')).choice).toBe('rejected');
    expect(run('borlabs-cookie=' + encodeURIComponent('{"consents":{"essential":[],"statistics":["ga"]}}')).choice).toBe('custom');
    expect(run('borlabs-cookie={bad').choice).toBe('unknown');
    expect(run('real_cookie_banner-v:1=abc')).toMatchObject({ name: 'Real Cookie Banner', choice: 'unknown' });
  });
  it('detects a banner by its script and reports no banner otherwise', () => {
    expect(run('', 'https://s.com/wp-content/plugins/borlabs-cookie/x.js')).toEqual({ name: 'Borlabs Cookie', choice: 'none', choiceIndex: -1 });
    expect(run('a=1')).toEqual({ name: '', choice: 'unknown', choiceIndex: -1 });
  });
});
