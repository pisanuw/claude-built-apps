import { describe, expect, it } from 'vitest';
import { ALERT_FROM, ALERT_LIMITS, alertDue, alertEmail, bypassAlertEmail, dueAlerts, triggeredAlerts, type AlertCounts } from '../src/signin/alerts.ts';
import { appDisplayName, escapeHtml, renderEmail, signInEmail, SIGN_IN_FROM } from '../src/signin/email.ts';

const NOW = new Date('2026-11-10T12:00:00Z');
const counts = (over: Partial<AlertCounts> = {}): AlertCounts => ({ ip_addresses_1h: 1, browser_addresses_1h: 1, email_requests_1h: 1, ip_challenge_failures_1h: 0, sent_1h: 1, alerts: {}, ...over });
const hashes = { email_hash: 'e'.repeat(64), ip_hash: 'a'.repeat(64), browser_hash: 'b'.repeat(64) };

describe('the sign-in email', () => {
  const link = 'https://paste-md.hintwise.org/?token_hash=abc&type=email';
  it('names the app when the slug is the link\'s own subdomain', () => {
    expect(appDisplayName('paste-md', 'https://paste-md.hintwise.org/x')).toBe('Paste Md');
    expect(appDisplayName('free-money', 'https://paste-md.hintwise.org/')).toBeNull();
    expect(appDisplayName('x', 'not a url')).toBeNull();
  });
  it('has the link, the expiry and the ignore line in text and HTML', () => {
    const m = signInEmail('ann@example.com', link, 'Paste Md');
    expect(m.from).toBe(SIGN_IN_FROM);
    expect(m.to).toEqual(['ann@example.com']);
    expect(m.subject).toBe('Your sign-in link for Paste Md');
    expect(m.text).toContain('sign in to Paste Md (paste-md.hintwise.org)');
    expect(m.text).toContain(`\n\n${link}\n\n`);
    expect(m.text).toContain('expires in about an hour. If you did not ask for it, ignore this email.');
    expect(m.text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(m.html).toContain('href="https://paste-md.hintwise.org/?token_hash=abc&amp;type=email"');
    expect(m.html).toContain('ignore this email');
  });
  it('uses the plain subject when the app is not known', () => {
    const m = signInEmail('ann@example.com', link, null);
    expect(m.subject).toBe('Your sign-in link');
    expect(m.text).toContain('sign in to paste-md.hintwise.org:');
  });
  it('escapes everything in the HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const m = renderEmail({ to: 'a@b.org', subject: 's', intro: ['<b>hi</b>'], code: '<1>', outro: ['bye & go'] });
    expect(m.html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(m.html).toContain('&lt;1&gt;');
    expect(m.html).toContain('bye &amp; go');
    expect(m.text).toBe('<b>hi</b>\n\n<1>\n\nbye & go\n\nHintWise\n');
  });
});

describe('alert rules', () => {
  it('stay quiet below every threshold', () => {
    expect(triggeredAlerts(counts({ ip_addresses_1h: 4, browser_addresses_1h: 4, email_requests_1h: 4, ip_challenge_failures_1h: 2, sent_1h: 100 }))).toEqual([]);
  });
  it('fire at the thresholds', () => {
    expect(triggeredAlerts(counts({ ip_addresses_1h: ALERT_LIMITS.addressesPerHour }))).toEqual(['many-addresses']);
    expect(triggeredAlerts(counts({ browser_addresses_1h: 5 }))).toEqual(['many-addresses']);
    expect(triggeredAlerts(counts({ email_requests_1h: 5 }))).toEqual(['address-repeated']);
    expect(triggeredAlerts(counts({ ip_challenge_failures_1h: 3 }))).toEqual(['challenge-failures']);
    expect(triggeredAlerts(counts({ sent_1h: 101 }))).toEqual(['volume']);
    expect(triggeredAlerts(counts({ ip_addresses_1h: '9' as unknown as number, email_requests_1h: 7, ip_challenge_failures_1h: 4, sent_1h: 500 }))).toEqual(['many-addresses', 'address-repeated', 'challenge-failures', 'volume']);
  });
  it('ignore the IP counts when the IP is unknown', () => {
    expect(triggeredAlerts(counts({ ip_addresses_1h: 50, ip_challenge_failures_1h: 50 }), false)).toEqual([]);
  });
  it('send each kind at most once an hour', () => {
    expect(alertDue(null, NOW)).toBe(true);
    expect(alertDue('garbage', NOW)).toBe(true);
    expect(alertDue('2026-11-10T11:30:00Z', NOW)).toBe(false);
    expect(alertDue('2026-11-10T11:00:00Z', NOW)).toBe(true);
    const c = counts({ email_requests_1h: 6, sent_1h: 200, alerts: { 'address-repeated': '2026-11-10T11:59:00Z', volume: '2026-11-10T09:00:00Z' } });
    expect(dueAlerts(c, NOW)).toEqual(['volume']);
    expect(dueAlerts(counts({ sent_1h: 200, alerts: undefined }), NOW)).toEqual(['volume']);
  });
});

describe('alert emails', () => {
  it('go from builder@hintwise.org with counts and short hashes, no raw IP or address', () => {
    const m = alertEmail('many-addresses', counts({ ip_addresses_1h: 7, browser_addresses_1h: 2 }), { hashes, email: 'ann@example.com', app: 'paste-md', outcome: 'wait' }, 'owner@x.org');
    expect(m.from).toBe(ALERT_FROM);
    expect(m.to).toEqual(['owner@x.org']);
    expect(m.subject).toBe('HintWise sign-in alert: one IP or browser asked for many addresses');
    expect(m.text).toContain('7 different addresses (IP hash aaaaaaaaaaaaaaaa)');
    expect(m.text).toContain('2 different addresses (browser hash bbbbbbbbbbbbbbbb)');
    expect(m.text).toContain("where ip_hash like 'aaaaaaaaaaaaaaaa%'");
    expect(m.text).toContain('app paste-md, outcome wait');
    expect(m.text).not.toContain('ann@example.com');
  });
  it('point at the browser rows when the IP is unknown', () => {
    const m = alertEmail('many-addresses', counts({ browser_addresses_1h: 6 }), { hashes, ipKnown: false }, 'o@x.org');
    expect(m.text).not.toContain('IP hash');
    expect(m.text).toContain("where browser_hash like 'bbbbbbbbbbbbbbbb%'");
    expect(m.text).toContain('app (unknown), outcome (unknown)');
  });
  it('name the address only for the repeated-address alert', () => {
    const m = alertEmail('address-repeated', counts({ email_requests_1h: 6 }), { hashes, email: 'ann@example.com' }, 'o@x.org');
    expect(m.text).toContain('links for ann@example.com were asked for 6 times');
    expect(m.text).toContain("email_hash like 'eeeeeeeeeeeeeeee%'");
    expect(alertEmail('address-repeated', counts(), { hashes: { ...hashes, email_hash: null } }, 'o@x.org').text).toContain('links for one address');
  });
  it('report failed challenges and volume', () => {
    expect(alertEmail('challenge-failures', counts({ ip_challenge_failures_1h: 4 }), { hashes }, 'o@x.org').text).toContain('4 Turnstile checks failed from one IP');
    const v = alertEmail('volume', counts({ sent_1h: 150 }), { hashes }, 'o@x.org');
    expect(v.text).toContain('150 sign-in links went out in the last hour');
    expect(v.text).not.toContain('select created_at');
  });
  it('report a bypass with the hashed address and the return host', () => {
    const m = bypassAlertEmail('o@x.org', { emailHash: 'c'.repeat(64), actionType: 'magiclink', redirectHost: 'old-app.netlify.app' });
    expect(m.subject).toBe('HintWise sign-in alert: a sign-in email went around sign-in-link');
    expect(m.text).toContain('email a magiclink directly');
    expect(m.text).toContain('Address hash cccccccccccccccc; return page old-app.netlify.app.');
    const none = bypassAlertEmail('o@x.org', { emailHash: null, actionType: 'signup', redirectHost: null });
    expect(none.text).toContain('Address hash (none); return page (none).');
    expect(none.text).not.toContain('select created_at');
  });
});
