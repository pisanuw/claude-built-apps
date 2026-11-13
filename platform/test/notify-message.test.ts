import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../src/notify/feed.ts';
import { chooseItems, MAX_ITEMS_PER_EMAIL, notifyEmail, notifyFrom, notifySubject, unsubscribeHeaders } from '../src/notify/message.ts';
import { footerHtml, footerText, renderEmail, SUPPORT_LINE } from '../src/signin/email.ts';

const APP = { slug: 'stepwise', displayName: 'StepWise' };
const APP_URL = 'https://auth.hintwise.org/functions/v1/email-optout?t=a1.stepwise.abc.sig';
const ALL_URL = 'https://auth.hintwise.org/functions/v1/email-optout?t=v1.abc.sig';
const it1: FeedItem = { id: 'p1', title: 'Fractions, step by step', url: 'https://stepwise.hintwise.org/p/1', date: '2026-11-12', summary: 'A new page on fractions.' };
const it2: FeedItem = { id: 'p2', title: 'Decimals <b>&</b> "you"', url: 'https://stepwise.hintwise.org/p/2?a=1&b=2' };

describe('notifyFrom', () => {
  it('is the display name and <slug>@hintwise.org', () => {
    expect(notifyFrom(APP)).toBe('StepWise <stepwise@hintwise.org>');
  });
  it('throws on a name or slug that could break the header', () => {
    expect(() => notifyFrom({ slug: 'stepwise', displayName: 'Step"Wise <x@y.z>' })).toThrow();
    expect(() => notifyFrom({ slug: 'stepwise', displayName: 'Step\r\nBcc: x@y.z' })).toThrow();
    expect(() => notifyFrom({ slug: 'step wise', displayName: 'StepWise' })).toThrow();
  });
});

describe('chooseItems and notifySubject', () => {
  it('keeps feed order, only the wanted ids, at most ten', () => {
    const feed = Array.from({ length: 15 }, (_, i) => ({ ...it1, id: `p${i}` }));
    expect(chooseItems(feed, ['p3', 'p1']).map((i) => i.id)).toEqual(['p1', 'p3']);
    expect(chooseItems(feed, feed.map((i) => i.id))).toHaveLength(MAX_ITEMS_PER_EMAIL);
    expect(chooseItems(feed, ['nope'])).toEqual([]);
  });
  it('names one item, or counts several, on one line', () => {
    expect(notifySubject(APP, [it1])).toBe('New in StepWise: Fractions, step by step');
    expect(notifySubject(APP, [it1, it2])).toBe('New in StepWise: 2 updates');
    expect(notifySubject(APP, [{ ...it1, title: `x\r\ny ${'z'.repeat(300)}` }])).not.toMatch(/[\r\n]/);
    expect(notifySubject(APP, [{ ...it1, title: 'z'.repeat(300) }]).length).toBe(150);
  });
});

describe('unsubscribeHeaders', () => {
  it('names the app link and a mailto, and asks for one-click POST', () => {
    expect(unsubscribeHeaders(APP, APP_URL)).toEqual({
      'List-Unsubscribe': `<${APP_URL}>, <mailto:support@hintwise.org?subject=unsubscribe%20stepwise>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
  it('throws on a link that is not plain https, or a bad slug', () => {
    for (const bad of ['http://x/', 'https://x/\r\nBcc: y', 'https://x/>, <mailto:evil@x', 'https://x/ y', 'https://x/\u00e9']) {
      expect(() => unsubscribeHeaders(APP, bad), bad).toThrow();
    }
    expect(() => unsubscribeHeaders({ slug: 'A B', displayName: 'X' }, APP_URL)).toThrow();
  });
});

describe('notifyEmail', () => {
  it('sends from the app, replies to support, carries the one-click headers', () => {
    const m = notifyEmail(APP, 'ann@example.com', [it1, it2], { appOptOutUrl: APP_URL, optOutUrl: ALL_URL });
    expect(m.from).toBe('StepWise <stepwise@hintwise.org>');
    expect(m.to).toEqual(['ann@example.com']);
    expect(m.reply_to).toBe('support@hintwise.org');
    expect(m.subject).toBe('New in StepWise: 2 updates');
    expect(m.headers).toEqual(unsubscribeHeaders(APP, APP_URL));
  });
  it('lists the items in text and HTML, escaped, with the HintWise header and both stop links', () => {
    const m = notifyEmail(APP, 'ann@example.com', [it1, it2], { appOptOutUrl: APP_URL, optOutUrl: ALL_URL, logoUrl: null });
    expect(m.text).toContain('What is new in StepWise (stepwise.hintwise.org):');
    expect(m.text).toContain('Fractions, step by step (2026-11-12)\nhttps://stepwise.hintwise.org/p/1\nA new page on fractions.');
    expect(m.text).toContain('Decimals <b>&</b> "you"\nhttps://stepwise.hintwise.org/p/2?a=1&b=2');
    expect(m.text).toContain(`Turn off StepWise emails: ${APP_URL}`);
    expect(m.text).toContain(`Stop all email from HintWise (sign-in links too): ${ALL_URL}`);
    expect(m.text).toContain('Questions? support@hintwise.org (or just reply).');
    expect(m.text).not.toContain('trouble signing in');
    expect(m.text.indexOf('Turn off StepWise emails')).toBeLessThan(m.text.indexOf('Stop all email'));
    expect(m.html).toContain('<p class="hw-brand"');
    expect(m.html).toContain('Decimals &lt;b&gt;&amp;&lt;/b&gt; &quot;you&quot;');
    expect(m.html).toContain('href="https://stepwise.hintwise.org/p/2?a=1&amp;b=2"');
    expect(m.html).not.toContain('<b>&</b>');
    expect(m.html).toContain(`>Turn off StepWise emails</a>`);
    expect(m.html).toContain('>Stop all email from HintWise</a> (sign-in links too)');
    expect(m.html).toContain('You got this because you asked StepWise to email you when it has something new.');
    expect(m.html).not.toMatch(/postal|unsubscribe from all marketing/i);
  });
  it('says "Something new" for one item, and names support when there is no global link', () => {
    const m = notifyEmail(APP, 'ann@example.com', [it1], { appOptOutUrl: APP_URL, optOutUrl: null });
    expect(m.text).toContain('Something new in StepWise (stepwise.hintwise.org):');
    expect(m.text).toContain('To stop all email from HintWise (sign-in links too), write to support@hintwise.org.');
  });
  it('refuses an empty list', () => {
    expect(() => notifyEmail(APP, 'ann@example.com', [], { appOptOutUrl: APP_URL, optOutUrl: null })).toThrow('no items');
  });
});

describe('email.ts additions leave the existing emails alone', () => {
  it('footerText and footerHtml without options are the sign-in footer', () => {
    expect(footerText('why', null)[1]).toBe(SUPPORT_LINE);
    expect(footerHtml('why', null)).toContain('Questions or trouble signing in? <a');
    expect(footerHtml('why', 'https://x.hintwise.org/', { appStop: { label: 'L', url: null } })).not.toContain('>L</a>');
    expect(footerText('why', null, { appStop: null })).toHaveLength(4);
  });
  it('renderEmail without items or footer options is unchanged', () => {
    const parts = { to: 'a@b.co', subject: 's', intro: ['i'], outro: ['o'], why: 'w' };
    expect(renderEmail({ ...parts, items: [], footer: {} })).toEqual(renderEmail(parts));
  });
});
