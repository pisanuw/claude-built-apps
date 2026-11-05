/**
 * Known popup, cookie-banner, chat and age-gate apps, recognised by the ids,
 * classes, tag names and frame addresses they put on a page. A match is a
 * hint ("looks like"), shown so the owner knows whose settings to look at or
 * whose support to write to.
 */
import { allElements } from './dom';

export type OverlayKind = 'email' | 'age' | 'cookie' | 'chat' | 'other';

export interface KnownApp {
  name: string;
  kind: OverlayKind;
  /** Lower-case fragments looked for in id, class, tag name and frame/script src. */
  marks: string[];
}

export const KNOWN_APPS: KnownApp[] = [
  { name: 'Klaviyo', kind: 'email', marks: ['klaviyo', 'kl-private-reset-css'] },
  { name: 'Privy', kind: 'email', marks: ['privy'] },
  { name: 'Justuno', kind: 'email', marks: ['justuno'] },
  { name: 'OptinMonster', kind: 'email', marks: ['optinmonster', 'om-holder'] },
  { name: 'Mailchimp', kind: 'email', marks: ['mailchimp', 'mc-modal', 'popupsignupform'] },
  { name: 'Omnisend', kind: 'email', marks: ['omnisend'] },
  { name: 'Shopify Forms', kind: 'email', marks: ['shopify-forms'] },
  { name: 'Wisepops', kind: 'email', marks: ['wisepops'] },
  { name: 'Poptin', kind: 'email', marks: ['poptin'] },
  { name: 'Sumo', kind: 'email', marks: ['sumome', 'sumo-'] },
  { name: 'Mailmunch', kind: 'email', marks: ['mailmunch'] },
  { name: 'OneTrust', kind: 'cookie', marks: ['onetrust'] },
  { name: 'Cookiebot', kind: 'cookie', marks: ['cybotcookiebot', 'cookiebot'] },
  { name: 'CookieYes', kind: 'cookie', marks: ['cky-consent', 'cookieyes'] },
  { name: 'Complianz', kind: 'cookie', marks: ['cmplz'] },
  { name: 'Termly', kind: 'cookie', marks: ['termly'] },
  { name: 'Osano', kind: 'cookie', marks: ['osano'] },
  { name: 'iubenda', kind: 'cookie', marks: ['iubenda'] },
  { name: 'Usercentrics', kind: 'cookie', marks: ['usercentrics'] },
  { name: 'Shopify cookie banner', kind: 'cookie', marks: ['shopify-pc__'] },
  { name: 'Pandectes', kind: 'cookie', marks: ['pandectes'] },
  { name: 'Consentmo', kind: 'cookie', marks: ['consentmo'] },
  { name: 'Cookie Notice (WordPress)', kind: 'cookie', marks: ['cookie-notice'] },
  { name: 'CookieLawInfo (WordPress)', kind: 'cookie', marks: ['cookie-law-info'] },
  { name: 'Intercom', kind: 'chat', marks: ['intercom'] },
  { name: 'Tidio', kind: 'chat', marks: ['tidio'] },
  { name: 'Gorgias', kind: 'chat', marks: ['gorgias'] },
  { name: 'Shopify Inbox', kind: 'chat', marks: ['shopifychat', 'inbox-online-store'] },
  { name: 'Zendesk', kind: 'chat', marks: ['zendesk', 'zdassets', 'zopim'] },
  { name: 'Crisp', kind: 'chat', marks: ['crisp-client', 'crisp.chat'] },
  { name: 'Drift', kind: 'chat', marks: ['drift-widget', 'drift-frame'] },
  { name: 'HubSpot chat', kind: 'chat', marks: ['hubspot-messages'] },
  { name: 'tawk.to', kind: 'chat', marks: ['tawk'] },
  { name: 'LiveChat', kind: 'chat', marks: ['chat-widget-container', 'livechatinc'] },
  { name: 'WhatsApp button', kind: 'chat', marks: ['whatsapp'] },
  { name: 'an age-gate plugin', kind: 'age', marks: ['age-gate', 'agegate', 'age-verif', 'ageverif'] },
];

function marksOf(el: Element): string {
  const parts = [el.id, el.getAttribute('class') ?? '', el.tagName, el.getAttribute('src') ?? '', el.getAttribute('data-testid') ?? ''];
  return parts.join(' ').toLowerCase();
}

/** The app whose marks appear in lower-case text, if any. */
export function appFromMarks(text: string): KnownApp | undefined {
  return KNOWN_APPS.find((app) => app.marks.some((m) => text.includes(m)));
}

/** The app whose marks appear on the element or inside it, if any. */
export function identifyApp(el: Element): KnownApp | undefined {
  return appFromMarks([el, ...allElements(el)].slice(0, 400).map(marksOf).join(' '));
}

/** Apps whose scripts or elements are on the page, open or not. */
export function appsOnPage(doc: Document): string[] {
  const seen = new Set<string>();
  const scripts = Array.from(doc.querySelectorAll('script[src], iframe[src], link[href]')).map((s) =>
    (s.getAttribute('src') ?? s.getAttribute('href') ?? '').toLowerCase(),
  );
  const marks = [...scripts, ...allElements(doc.body ?? doc.documentElement).slice(0, 5000).map(marksOf)].join(' ');
  for (const app of KNOWN_APPS) {
    if (app.marks.some((m) => marks.includes(m))) seen.add(app.name);
  }
  return [...seen];
}
