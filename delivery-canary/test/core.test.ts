import { describe, expect, it } from 'vitest';
import {
  aligned,
  dkimSignatureDomain,
  headerValues,
  labelPlacement,
  orgDomain,
  parseAuthResults,
  receivedTime,
  stripComments,
  summariseAuth,
  transit,
} from '../src/core/headers';
import { decodeEntities, detectApp, downloadCandidates, extractLinks, isShortener, scoreLink } from '../src/core/links';
import { emptyResult, fileNameOf, hex, isPageType, pageSaysExpired, pageTitleOf, parseLinkResult } from '../src/core/linkcheck';
import { sampleEmail, sampleFileUrl } from '../src/core/sample';
import { analyseEmail, EmailError, looksLikeEmail, MAX_EMAIL_BYTES, trimShowOriginal } from '../src/core/email';

describe('headers', () => {
  it('finds header values case-insensitively, in order', () => {
    const hs = [{ key: 'Received', value: 'a' }, { key: 'x', value: 'y' }, { key: 'received', value: 'b' }];
    expect(headerValues(hs, 'RECEIVED')).toEqual(['a', 'b']);
  });
  it('strips comments, nested one level', () => {
    expect(stripComments('pass (google.com: x (y) z) smtp.mailfrom=a')).toBe('pass  smtp.mailfrom=a');
  });
  it('parses Authentication-Results', () => {
    const r = parseAuthResults('mx.google.com; dkim=pass header.i=@shop.example header.s=s1; spf=softfail (x) smtp.mailfrom="b@Mail.Example"; dmarc=fail (p=REJECT) header.from=shop.example; arc=pass; bogus');
    expect(r.authServ).toBe('mx.google.com');
    expect(r.results).toEqual([
      { method: 'dkim', result: 'pass', domain: 'shop.example' },
      { method: 'spf', result: 'softfail', domain: 'mail.example' },
      { method: 'dmarc', result: 'fail', domain: 'shop.example' },
    ]);
  });
  it('falls back to header.d, smtp.helo and empty domains', () => {
    expect(parseAuthResults('mx; dkim=fail header.d=a.example; spf=none smtp.helo=h.example; dmarc=none').results).toEqual([
      { method: 'dkim', result: 'fail', domain: 'a.example' },
      { method: 'spf', result: 'none', domain: 'h.example' },
      { method: 'dmarc', result: 'none', domain: '' },
    ]);
    expect(parseAuthResults('').authServ).toBe('');
  });
  it('reads DKIM-Signature d=', () => {
    expect(dkimSignatureDomain('v=1; a=rsa-sha256; d=Shop.Example; s=x')).toBe('shop.example');
    expect(dkimSignatureDomain('v=1; s=x')).toBe('');
  });
  it('summarises auth from the top Authentication-Results only', () => {
    const s = summariseAuth([
      { key: 'Authentication-Results', value: 'mx.google.com; spf=pass smtp.mailfrom=a.example' },
      { key: 'Authentication-Results', value: 'evil; dkim=pass header.d=forged.example' },
      { key: 'DKIM-Signature', value: 'd=a.example; s=1' },
    ]);
    expect(s?.spf?.result).toBe('pass');
    expect(s?.dkim).toEqual([]);
    expect(s?.signedBy).toEqual(['a.example']);
  });
  it('summarises signatures without results, and nothing without either', () => {
    expect(summariseAuth([{ key: 'DKIM-Signature', value: 'd=a.example' }])).toEqual({ authServ: '', spf: null, dkim: [], dmarc: null, signedBy: ['a.example'] });
    expect(summariseAuth([])).toBeNull();
  });
  it('reads Received times and transit', () => {
    expect(receivedTime('from a by b; Thu, 12 Nov 2026 02:14:02 -0800 (PST)')).toBe('2026-11-12T10:14:02.000Z');
    expect(receivedTime('no date here')).toBe('');
    expect(receivedTime('x; not a date')).toBe('');
    const hs = [
      { key: 'Received', value: 'by mx; Thu, 12 Nov 2026 10:20:00 +0000' },
      { key: 'Received', value: 'broken' },
      { key: 'Received', value: 'from app; Thu, 12 Nov 2026 10:00:00 +0000' },
    ];
    expect(transit(hs)).toEqual({ receivedAt: '2026-11-12T10:20:00.000Z', seconds: 1200 });
    expect(transit([hs[0]])).toEqual({ receivedAt: '2026-11-12T10:20:00.000Z', seconds: null });
    expect(transit([])).toEqual({ receivedAt: '', seconds: null });
  });
  it('reads placement from X-Gmail-Labels', () => {
    const p = (v: string) => labelPlacement([{ key: 'X-Gmail-Labels', value: v }]);
    expect(p('Spam,Unread')).toBe('spam');
    expect(p('Inbox,Category Promotions')).toBe('promotions');
    expect(p('Inbox,Opened')).toBe('inbox');
    expect(p('Archived')).toBe('other');
    expect(labelPlacement([])).toBeNull();
  });
  it('finds organizational domains and alignment', () => {
    expect(orgDomain('mail.shop.example.co.uk')).toBe('example.co.uk');
    expect(orgDomain('a.b.shopifyemail.com.')).toBe('shopifyemail.com');
    expect(orgDomain('example.com')).toBe('example.com');
    expect(aligned('news.shop.com', 'shop.com')).toBe(true);
    expect(aligned('shopifyemail.com', 'shop.com')).toBe(false);
    expect(aligned('', 'shop.com')).toBe(false);
  });
});

describe('links', () => {
  it('decodes entities in hrefs', () => {
    expect(decodeEntities('a&amp;b&#x41;&#66;&quot;&#39;&lt;&gt;&nbsp;')).toBe('a&bAB"\'<> ');
  });
  it('scores download links above others and drops unsubscribe and social links', () => {
    expect(scoreLink('https://cdn.example/files/pattern.pdf', 'Download your pattern')).toBeGreaterThan(5);
    expect(scoreLink('https://shop.example/', 'Visit our shop')).toBeLessThan(0 + 1);
    expect(scoreLink('https://shop.example/pages/unsubscribe', 'x')).toBe(-1);
    expect(scoreLink('https://shop.example/x', 'Unsubscribe')).toBe(-1);
    expect(scoreLink('https://instagram.com/x', 'Instagram')).toBe(-1);
    expect(scoreLink('ftp://x.example/a.pdf', 'Download')).toBe(-1);
    expect(scoreLink('https://www.skypilotapp.com/orders/abc', 'Access your files')).toBeGreaterThanOrEqual(8);
  });
  it('extracts anchors and bare text URLs, best first, without duplicates', () => {
    const html = `<a href="https://a.example/shop">Shop</a> <a href='https://a.example/download/1?x=1&amp;y=2'>Download <b>now</b></a> <a href=https://a.example/download/1?x=1&amp;y=2>again</a> <a href="mailto:x@y">mail</a>`;
    const links = extractLinks(html, 'Your file: https://a.example/d/file.zip). Thanks');
    expect(links[0].url).toBe('https://a.example/download/1?x=1&y=2');
    expect(links[0].text).toBe('Download now');
    expect(links.map((l) => l.url)).toContain('https://a.example/d/file.zip');
    expect(links.filter((l) => l.url.includes('download/1'))).toHaveLength(1);
    expect(extractLinks(undefined, undefined)).toEqual([]);
    expect(downloadCandidates(links).every((l) => l.score >= 3)).toBe(true);
  });
  it('recognises shorteners', () => {
    expect(isShortener('bit.ly')).toBe(true);
    expect(isShortener('example.com')).toBe(false);
  });
  it('detects the delivery app from the sender, the links or the signer', () => {
    const dl = (url: string) => [{ url, text: 'Download', score: 8 }];
    expect(detectApp('orders@sendowl.com', [], []).id).toBe('sendowl');
    expect(detectApp('hi@shop.example', [], dl('https://download.filemonk.app/x')).because).toBe('download link on download.filemonk.app');
    expect(detectApp('hi@shop.example', ['bigdigitaldownloads.com'], []).id).toBe('big');
    expect(detectApp('hi@shop.example', ['shopifyemail.com'], dl('https://www.skypilotapp.com/d/1')).id).toBe('sky-pilot');
    expect(detectApp('hi@shop.example', ['shopifyemail.com'], []).id).toBe('shopify');
    expect(detectApp('', [], [])).toEqual({ id: 'unknown', name: 'Not recognised', because: '' });
  });
});

describe('linkcheck helpers', () => {
  it('tells pages from files', () => {
    expect(isPageType('text/html')).toBe(true);
    expect(isPageType(' application/xhtml+xml')).toBe(true);
    expect(isPageType('application/pdf')).toBe(false);
  });
  it('reads file names', () => {
    expect(fileNameOf("attachment; filename*=UTF-8''Meadow%20Cardigan.pdf", 'https://x/y')).toBe('Meadow Cardigan.pdf');
    expect(fileNameOf("attachment; filename*=UTF-8''%E0%A4%A.pdf; filename=\"b.pdf\"", 'https://x/y')).toBe('b.pdf');
    expect(fileNameOf('attachment; filename="a b.zip"', 'https://x/y')).toBe('a b.zip');
    expect(fileNameOf('attachment; filename=plain.zip', 'https://x/y')).toBe('plain.zip');
    expect(fileNameOf('', 'https://x/files/My%20File.pdf?sig=1')).toBe('My File.pdf');
    expect(fileNameOf('', 'https://x/download/abc')).toBe('');
    expect(fileNameOf('', 'not a url')).toBe('');
  });
  it('reads page titles and expiry wording', () => {
    expect(pageTitleOf('<title>\n Download   expired </title>')).toBe('Download expired');
    expect(pageTitleOf('<p>x</p>')).toBe('');
    expect(pageSaysExpired('<p>Sorry, this link has expired.</p>')).toBe(true);
    expect(pageSaysExpired('<p>You reached the download limit</p>')).toBe(true);
    expect(pageSaysExpired('<script>var s="link has expired"</script><p>Your files</p>')).toBe(false);
  });
  it('hex-encodes and builds empty results', () => {
    expect(hex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff');
    expect(emptyResult('u', 'e')).toMatchObject({ url: 'u', finalUrl: 'u', error: 'e', status: 0 });
  });
  it('accepts only a well-formed server result', () => {
    const ok = parseLinkResult({ finalUrl: 'https://b', status: 200, redirects: 1, contentType: 'application/pdf', fileName: 'a.pdf', size: 10, truncated: false, sha256: 'a'.repeat(64), page: false, pageTitle: '', pageSaysExpired: false, error: '' }, 'https://a');
    expect(ok).toMatchObject({ url: 'https://a', finalUrl: 'https://b', status: 200, size: 10, sha256: 'a'.repeat(64) });
    const bad = parseLinkResult({ status: -1, size: 'x', sha256: 'zz', page: 'yes', error: 5 }, 'https://a');
    expect(bad).toMatchObject({ finalUrl: 'https://a', status: 0, size: 0, sha256: '', page: false, error: '' });
    expect(parseLinkResult(null, 'u').url).toBe('u');
  });
});

describe('email', () => {
  it('reads the sample', async () => {
    const a = await analyseEmail(sampleEmail('https://x.example/sample/canary-pattern.pdf'));
    expect(a.from).toEqual({ name: 'Juniper Stitch', address: 'hello@juniperstitch.example' });
    expect(a.subject).toContain('Meadow Cardigan');
    expect(a.transitSeconds).toBe(39);
    expect(a.auth?.dmarc?.result).toBe('none');
    expect(a.app.id).toBe('shopify');
    expect(a.labelPlacement).toBe('promotions');
    expect(a.links[0].url).toBe('https://x.example/sample/canary-pattern.pdf');
    expect(a.listUnsubscribe).toBe(false);
  });
  it('reads an ArrayBuffer', async () => {
    const buf = new TextEncoder().encode('From: A <A@Shop.Example>\r\nSubject: Hi\r\nDate: nonsense\r\nList-Unsubscribe: <mailto:x>\r\n\r\nGet your download: https://shop.example/download/x.pdf\r\n').buffer;
    const a = await analyseEmail(buf);
    expect(a.from.address).toBe('a@shop.example');
    expect(a.sentAt).toBe('');
    expect(a.auth).toBeNull();
    expect(a.listUnsubscribe).toBe(true);
    expect(a.links[0].url).toBe('https://shop.example/download/x.pdf');
  });
  it('handles a missing From', async () => {
    const a = await analyseEmail('Subject: x\r\n\r\nbody');
    expect(a.from).toEqual({ name: '', address: '' });
    expect(a.subject).toBe('x');
  });
  it('refuses empty, huge and non-email input', async () => {
    await expect(analyseEmail('')).rejects.toBeInstanceOf(EmailError);
    await expect(analyseEmail(new ArrayBuffer(MAX_EMAIL_BYTES + 1))).rejects.toThrow(/over 5 MB/);
    await expect(analyseEmail('just some words')).rejects.toThrow(/does not look like an email/);
  });
  it("trims the summary of Gmail's Show original page", () => {
    const raw = 'Original message\nMessage ID\t<x>\nCreated at:\tThu\n\nDelivered-To: a@b\nFrom: x@y\n\nbody';
    expect(trimShowOriginal(raw).startsWith('Delivered-To: a@b')).toBe(true);
    expect(trimShowOriginal('From: x\n\nb')).toBe('From: x\n\nb');
    expect(looksLikeEmail('From: x\n\nb')).toBe(true);
    expect(looksLikeEmail('hello')).toBe(false);
  });
  it('builds the sample file URL', () => {
    expect(sampleFileUrl('https://a.example', '/')).toBe('https://a.example/sample/canary-pattern.pdf');
    expect(sampleFileUrl('https://a.example', '/sub')).toBe('https://a.example/sub/sample/canary-pattern.pdf');
  });
});
