import { describe, expect, it } from 'vitest';
import { ALERT_FROM, ALERT_LIMITS, alertDue, alertEmail, bypassAlertEmail, dueAlerts, triggeredAlerts, type AlertCounts } from '../src/signin/alerts.ts';
import {
  appDisplayName,
  BRAND_INDIGO,
  codeEmail,
  emailChangeCurrentEmail,
  emailChangeNewEmail,
  emailLogoUrl,
  escapeHtml,
  footerHtml,
  footerText,
  headerHtml,
  inviteEmail,
  noticeEmail,
  reauthenticationEmail,
  recoveryEmail,
  renderEmail,
  signInEmail,
  signupEmail,
  SIGN_IN_FROM,
  SUPPORT_EMAIL,
} from '../src/signin/email.ts';
import type { EmailMessage } from '../src/signin/resend.ts';

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
  it('names another site when the link goes through Auth (the hook)', () => {
    const m = signInEmail('ann@example.com', 'https://ref.supabase.co/auth/v1/verify?token=t&type=magiclink', null, 'how-of-happiness.netlify.app');
    expect(m.text).toContain('sign in to how-of-happiness.netlify.app:');
  });
  it('has the hook\'s sign-up, code and recovery emails', () => {
    const s1 = signupEmail('ann@example.com', 'https://ref.supabase.co/auth/v1/verify?token=t&type=signup', 'wcv.example.org');
    expect(s1.subject).toBe('Confirm your email address');
    expect(s1.text).toContain('To finish signing up at wcv.example.org, confirm your email address:');
    const c = codeEmail('ann@example.com', '123456', 'wcv.example.org');
    expect(c.subject).toBe('Your sign-in code');
    expect(c.text).toContain('\n\n123456\n\n');
    expect(c.text).toContain('The code expires in about an hour.');
    const r = recoveryEmail('ann@example.com', 'https://ref.supabase.co/auth/v1/verify?token=t&type=recovery');
    expect(r.subject).toBe('Reset your password');
    for (const m of [s1, c, r]) expect(m.from).toBe(SIGN_IN_FROM);
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
    expect(m.text).toBe('<b>hi</b>\n\n<1>\n\nbye & go\n');
    expect(m.html).not.toContain('<hr');
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

const LOGO = 'https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png';
const STOP = 'https://auth.hintwise.org/functions/v1/email-optout?t=v1.abc.def';
const look = { optOutUrl: STOP, logoUrl: LOGO };
const footerOf = (m: EmailMessage): string[] => m.text.split('\n----\n')[1].trim().split('\n');

describe('the footer', () => {
  const HOOK = 'https://ref.supabase.co/auth/v1/verify?token=t&type=x';
  const cases: Array<[string, EmailMessage, string]> = [
    ['sign-in link', signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/?token_hash=a', 'Pluck Lab', undefined, look), "You got this because someone asked to sign in to Pluck Lab with this address. If it wasn't you, ignore it: nothing happens."],
    ['hook magic link', signInEmail('ann@example.com', HOOK, null, 'wcv.example.org', look), 'You got this because someone asked to sign in to wcv.example.org with this address.'],
    ['sign-in code', codeEmail('ann@example.com', '123456', 'wcv.example.org', look), 'You got this because someone asked for a code to sign in to wcv.example.org with this address.'],
    ['signup', signupEmail('ann@example.com', HOOK, 'wcv.example.org', look), "You got this because someone signed up at wcv.example.org with this address. If it wasn't you, ignore it: the address stays unconfirmed."],
    ['recovery', recoveryEmail('ann@example.com', HOOK, 'wcv.example.org', look), 'reset the password of the account with this address on wcv.example.org. If it wasn\'t you, ignore it: the password stays the same.'],
    ['invite', inviteEmail('ann@example.com', HOOK, 'pluck-lab.hintwise.org', look), 'You got this because someone invited this address to an account on pluck-lab.hintwise.org.'],
    ['email change, current', emailChangeCurrentEmail('ann@example.com', 'new@example.com', HOOK, null, look), 'move the account with this address to another address. If it wasn\'t you, ignore it and change your password'],
    ['email change, new', emailChangeNewEmail('new@example.com', HOOK, null, look), 'You got this because someone asked to use this address for an account.'],
    ['reauthentication', reauthenticationEmail('ann@example.com', '123456', null, look), 'asked for a code to confirm a change. If it wasn\'t you, ignore it and change your password: nothing changes without the code.'],
    ['notification', noticeEmail('ann@example.com', 'password_changed_notification', 'pluck-lab.hintwise.org', look), 'You got this because the account with this address on pluck-lab.hintwise.org changed, and every change is reported to its address.'],
  ];
  it.each(cases)('%s: why, support, about and stop, in that order, in text and HTML', (_name, m, why) => {
    const lines = footerOf(m);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(why);
    expect(lines[1]).toBe('Questions or trouble signing in? support@hintwise.org (or just reply).');
    expect(lines[2]).toBe('HintWise builds tools for small businesses, startups and educators. More apps: https://studio.hintwise.org/');
    expect(lines[3]).toBe(`Stop all email from HintWise (sign-in links too): ${STOP}`);
    const foot = m.html.slice(m.html.indexOf('<hr'));
    const at = (needle: string) => foot.indexOf(needle);
    expect(at(escapeHtml(why))).toBeGreaterThan(0);
    expect(at(escapeHtml(why))).toBeLessThan(at('Questions or trouble signing in?'));
    expect(at('Questions or trouble signing in?')).toBeLessThan(at('HintWise builds tools'));
    expect(at('HintWise builds tools')).toBeLessThan(at('Stop all email from HintWise</a> (sign-in links too)'));
    expect(foot).toContain('<a class="hw-link" href="mailto:support@hintwise.org"');
    expect(foot).toContain('<a class="hw-link" href="https://studio.hintwise.org/" style="color:#312E81;text-decoration:underline">studio.hintwise.org</a>');
    expect(foot).toContain(`<a class="hw-link" href="${escapeHtml(STOP)}"`);
    expect(m.reply_to).toBe(SUPPORT_EMAIL);
    expect(m.from).toBe(SIGN_IN_FROM);
  });
  it('names support instead of a link when there is no opt-out link', () => {
    expect(footerText('Why.', null)[3]).toBe('To stop all email from HintWise (sign-in links too), write to support@hintwise.org.');
    expect(footerHtml('Why.', undefined)).toContain('To stop all email from HintWise (sign-in links too), write to <a class="hw-link" href="mailto:support@hintwise.org"');
    const m = signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/', 'Pluck Lab');
    expect(footerOf(m)[3]).toContain('write to support@hintwise.org');
  });
  it('escapes the why line and the opt-out link', () => {
    const h = footerHtml('<b>"x"</b>', 'https://auth.hintwise.org/x?t=a&b="c"');
    expect(h).toContain('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(h).toContain('href="https://auth.hintwise.org/x?t=a&amp;b=&quot;c&quot;"');
    const m = signupEmail('ann@example.com', 'https://x/', '<script>.example', look);
    expect(m.html).not.toContain('<script>');
  });
  it('ends the body without a "HintWise" sign-off: the header names it', () => {
    const m = signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/', 'Pluck Lab', undefined, look);
    expect(m.text.split('\n----\n')[0]).toMatch(/ignore this email\.\n*$/);
    expect(m.text).not.toMatch(/\n\nHintWise\n/);
    expect(m.html).not.toContain('<p>HintWise</p>');
    expect(m.html.match(/>HintWise</g)).toBeNull();
    expect(m.html).toContain('alt="HintWise"');
    const plain = signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/', 'Pluck Lab');
    expect(plain.html.match(/>HintWise</g)).toHaveLength(1);
  });
  it('sets no colour on body text, and keeps the owner\'s alerts without a footer', () => {
    const m = signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/', 'Pluck Lab', undefined, look);
    expect(m.html).toMatch(/<body style="[^"]*"/);
    expect(m.html.match(/<body style="([^"]*)"/)![1]).not.toContain('color');
    const alert = renderEmail({ to: 'o@x.org', subject: 's', intro: ['i'], outro: [] });
    expect(alert.text).not.toContain('----');
    expect(alert.reply_to).toBe(SUPPORT_EMAIL);
  });
});

describe('the header and the brand colours', () => {
  it('shows the logo at 100x28 with alt text, on a white panel', () => {
    const h = headerHtml(LOGO);
    expect(h).toContain(`<img src="${LOGO}" width="100" height="28" alt="HintWise"`);
    expect(h).toContain('bgcolor="#ffffff"');
    expect(h).toContain('role="presentation"');
    // With images off, the alt text reads as the wordmark.
    expect(h).toContain(`color:${BRAND_INDIGO};font-size:18px;font-weight:bold`);
  });
  it('falls back to the text wordmark: HintWise, deep indigo, bold, 18px', () => {
    for (const none of [null, undefined, '']) {
      expect(headerHtml(none)).toBe('<p class="hw-brand" style="margin:0 0 20px;color:#312E81;font-size:18px;font-weight:bold;line-height:28px">HintWise</p>');
    }
    const m = signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/', 'Pluck Lab');
    expect(m.html.indexOf('class="hw-brand"')).toBeLessThan(m.html.indexOf('Here is your link'));
  });
  it('puts the logo first in every visitor email when it is set', () => {
    const m = codeEmail('ann@example.com', '1', 'x.example', { logoUrl: LOGO });
    expect(m.html.indexOf('<img')).toBeLessThan(m.html.indexOf('Your code'));
  });
  it('colours the button and links deep indigo, never the old blue, and lightens them in dark mode', () => {
    const m = signInEmail('ann@example.com', 'https://pluck-lab.hintwise.org/', 'Pluck Lab', undefined, look);
    expect(m.html).toContain('background-color:#312E81;color:#ffffff');
    expect(m.html).not.toMatch(/#1d4ed8/i);
    expect(m.html).not.toMatch(/#FF7A45/i);
    expect(m.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(m.html).toContain('@media (prefers-color-scheme:dark){.hw-brand{color:#E0E7FF !important}.hw-link{color:#A5B4FC !important}}');
    expect(m.html).toContain('<html lang="en">');
    expect(m.html).toContain('<title>Your sign-in link for Pluck Lab</title>');
  });
  it('accepts EMAIL_LOGO_URL only as https on hintwise.org', () => {
    expect(emailLogoUrl(LOGO)).toBe(LOGO);
    expect(emailLogoUrl(` ${LOGO} `)).toBe(LOGO);
    expect(emailLogoUrl('https://hintwise.org/logo.png')).toBe('https://hintwise.org/logo.png');
    for (const bad of [undefined, null, '', 'not a url', 'http://auth.hintwise.org/x.png', 'https://evil.example/x.png', 'https://hintwise.org.evil.example/x.png', 'https://u:p@auth.hintwise.org/x.png', 'https://auth.hintwise.org:8443/x.png', 'javascript:alert(1)', `https://auth.hintwise.org/${'a'.repeat(600)}`]) {
      expect(emailLogoUrl(bad), String(bad)).toBeNull();
    }
    expect(emailLogoUrl('https://auth.hintwise.org/a b"<.png')).toBe('https://auth.hintwise.org/a%20b%22%3C.png');
  });
});
