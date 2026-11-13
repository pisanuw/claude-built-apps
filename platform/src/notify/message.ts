/**
 * The app-notify email (src/notify/README.md, "The email"): from
 * `<App name> <<slug>@hintwise.org>`, Reply-To support@hintwise.org, the
 * HintWise header and footer (src/signin/email.ts renderEmail) with "Turn
 * off <App> emails" above "Stop all email from HintWise", and the RFC 8058
 * one-click headers. Transactional: only the new pages of the app the person
 * asked to hear about; no promotion, so no postal address.
 */
import { renderEmail, SUPPORT_EMAIL, type EmailLook } from '../signin/email.ts';
import type { EmailMessage } from '../signin/resend.ts';
import { cleanText, type FeedItem } from './feed.ts';

/** At most this many items in one email; the rest wait for the next day. */
export const MAX_ITEMS_PER_EMAIL = 10;
/** notify_apps' display name check: no quotes, brackets, commas or dots, so the From needs no quoting. */
export const DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 &+'-]{0,39}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_SUBJECT_CHARS = 150;

export interface NotifyApp {
  slug: string;
  displayName: string;
}

export interface NotifyLinks {
  /** "Turn off <App> emails": the a1 token link (optout.ts appOptOutUrl). Required: no notify email goes out without it. */
  appOptOutUrl: string;
  /** "Stop all email from HintWise": the v1 token link (optout.ts optOutUrl). */
  optOutUrl: string | null;
  logoUrl?: string | null;
}

/** The From header: `<name> <<slug>@hintwise.org>`. Throws on a name or slug the registry would not allow. */
export function notifyFrom(app: NotifyApp): string {
  if (!SLUG.test(app.slug) || !DISPLAY_NAME.test(app.displayName)) throw new Error('notifyFrom: bad app name or slug');
  return `${app.displayName} <${app.slug}@hintwise.org>`;
}

/** The items of `ids` in feed order (newest first), at most MAX_ITEMS_PER_EMAIL. */
export function chooseItems(feed: readonly FeedItem[], ids: readonly string[], max = MAX_ITEMS_PER_EMAIL): FeedItem[] {
  const want = new Set(ids);
  return feed.filter((it) => want.has(it.id)).slice(0, max);
}

/** The subject: "New in StepWise: <title>" for one item, "New in StepWise: 3 updates" for more. One line. */
export function notifySubject(app: NotifyApp, items: readonly FeedItem[]): string {
  const what = items.length === 1 ? items[0].title : `${items.length} updates`;
  return cleanText(`New in ${app.displayName}: ${what}`, MAX_SUBJECT_CHARS);
}

/** A header value must be one line of printable ASCII. */
const headerSafe = (v: string): boolean => /^[\x20-\x7e]+$/.test(v);

/**
 * The List-Unsubscribe headers (RFC 2369, RFC 8058): the app stop link (one
 * POST of List-Unsubscribe=One-Click turns that app's email off) and a
 * mailto to support. Throws if the link is not a plain https URL.
 */
export function unsubscribeHeaders(app: NotifyApp, appOptOutUrl: string): Record<string, string> {
  if (!appOptOutUrl.startsWith('https://') || !headerSafe(appOptOutUrl) || /[<>,\s]/.test(appOptOutUrl)) throw new Error('unsubscribeHeaders: bad link');
  if (!SLUG.test(app.slug)) throw new Error('unsubscribeHeaders: bad slug');
  return {
    'List-Unsubscribe': `<${appOptOutUrl}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe%20${app.slug}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** The footer's first line. */
export const notifyWhy = (name: string): string =>
  `You got this because you asked ${name} to email you when it has something new. To stop, use "Turn off ${name} emails" below, or switch it off in ${name}.`;

/** One person's email about `items` (already chosen, at least one). */
export function notifyEmail(app: NotifyApp, to: string, items: readonly FeedItem[], links: NotifyLinks): EmailMessage {
  if (items.length === 0) throw new Error('notifyEmail: no items');
  const name = app.displayName;
  const look: EmailLook = { optOutUrl: links.optOutUrl, logoUrl: links.logoUrl ?? null };
  const msg = renderEmail(
    {
      to,
      subject: notifySubject(app, items),
      intro: [items.length === 1 ? `Something new in ${name} (${app.slug}.hintwise.org):` : `What is new in ${name} (${app.slug}.hintwise.org):`],
      items: items.map((it) => ({ title: it.title, url: it.url, date: it.date, summary: it.summary })),
      outro: [],
      why: notifyWhy(name),
      footer: { supportPrefix: 'Questions?', appStop: { label: `Turn off ${name} emails`, url: links.appOptOutUrl } },
    },
    notifyFrom(app),
    look,
  );
  return { ...msg, headers: unsubscribeHeaders(app, links.appOptOutUrl) };
}
