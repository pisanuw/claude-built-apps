import { CLAIM_RULES } from './claims';
import { KIND_LABEL } from './classify';
import { nameKey, phoneKey, postcodeOf } from './identity';
import type { DayRange, Evidence, Feed, Finding, MerchantSettings, PageError, PageFacts, Severity, ShippingClaim } from './types';
import { pageKey, shortUrl } from './urls';
import { formatRange, overlaps } from './windows';

/**
 * The cross-page comparison. Each check looks for one way a store can tell
 * shoppers (and Google's reviewers) two different things, and says where.
 * Nothing here can prove why Google suspended a store; it finds the
 * contradictions a reviewer could find.
 */

export interface CheckInput {
  pages: PageFacts[];
  errors: PageError[];
  feed?: Feed;
  settings?: MerchantSettings;
}

export const MERCHANT_CENTER = 'Merchant Center (what you entered)';
const MAX_EVIDENCE = 8;
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
/** Within a severity, the contradictions reviewers check most come first. */
const AREA_RANK: Record<Finding['area'], number> = { returns: 0, shipping: 1, price: 2, stock: 3, contact: 4, data: 5, pages: 6, wording: 7 };

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', JPY: '¥', NZD: 'NZ$' };
export const money = (n: number, currency?: string): string => {
  const c = currency?.toUpperCase();
  if (!c) return n.toFixed(2);
  return SYMBOLS[c] ? `${SYMBOLS[c]}${n.toFixed(2)}` : `${n.toFixed(2)} ${c}`;
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

function cap(evidence: Evidence[]): Evidence[] {
  if (evidence.length <= MAX_EVIDENCE) return evidence;
  return [...evidence.slice(0, MAX_EVIDENCE), { url: '', text: `…and ${evidence.length - MAX_EVIDENCE} more.` }];
}

/**
 * One piece of evidence per distinct value, so a banner repeated on every
 * page does not push the other value out of view. Pages are preferred over
 * banners: a policy page or FAQ is listed before a page that only repeats the
 * site-wide bar.
 */
export function byValue<T extends { url: string; text: string }>(items: T[], valueOf: (x: T) => string): Evidence[] {
  const groups = new Map<string, T[]>();
  for (const x of items) {
    const k = valueOf(x);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const out: Evidence[] = [];
  for (const list of groups.values()) {
    const pages = new Set(list.map((x) => x.url));
    const texts = new Map<string, number>();
    for (const x of list) texts.set(x.text, (texts.get(x.text) ?? 0) + 1);
    // The wording that appears on the fewest pages is the page's own; the most repeated is a banner.
    const best = [...list].sort((a, b) => (texts.get(a.text) ?? 0) - (texts.get(b.text) ?? 0))[0];
    const others = pages.size - 1;
    out.push({ url: best.url, text: others > 0 ? `${best.text} (also on ${plural(others, 'other page')})` : best.text });
  }
  return out;
}

const are = (n: number) => (n === 1 ? 'is' : 'are');
const have = (n: number) => (n === 1 ? 'has' : 'have');
const carry = (n: number) => (n === 1 ? 'carries' : 'carry');
const joinAnd = (xs: Array<string | number>) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|web|mail|zoho|yandex)\.[a-z.]+$/i;
const isGone = (e: PageError) => e.status === 404 || e.status === 410;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- pages

function pageChecks(pages: PageFacts[], errors: PageError[], out: Finding[]): void {
  const has = (k: PageFacts['kind']) => pages.some((p) => p.kind === k);
  const anyEmail = pages.some((p) => p.emails.length);
  const anyPhone = pages.some((p) => p.phones.length);
  if (!anyEmail && !anyPhone) {
    out.push({
      id: 'pages:no-contact',
      severity: 'high',
      area: 'pages',
      title: 'No email address or phone number was found',
      detail: 'None of the pages read shows an email address or phone number. Google expects shoppers to be able to reach the business, and a store with no contact details is a common Misrepresentation finding. A contact form alone is often not enough.',
      fix: 'Put a working email address (and a phone number if you have one) on a Contact page and in the footer of every page.',
      evidence: [],
    });
  }
  const shippingSaid = pages.some((p) => p.shipping.length);
  if (!has('shipping')) {
    out.push({
      id: 'pages:no-shipping',
      severity: shippingSaid ? 'medium' : 'high',
      area: 'pages',
      title: 'No shipping policy page was found',
      detail: shippingSaid
        ? 'Shipping times are mentioned on some pages, but there is no page dedicated to shipping. Reviewers look for one place that states costs, times and where you ship.'
        : 'No page about shipping was found, and no page states how long shipping takes. Google asks stores to state shipping costs and times clearly.',
      fix: 'Add a Shipping page that lists where you ship, how long you take to send an order, how long delivery takes, and what it costs. Link it in the footer.',
      evidence: [],
    });
  }
  const returnsSaid = pages.some((p) => p.returns.length);
  if (!has('returns')) {
    out.push({
      id: 'pages:no-returns',
      severity: returnsSaid ? 'medium' : 'high',
      area: 'pages',
      title: 'No returns or refund policy page was found',
      detail: returnsSaid
        ? 'Returns are mentioned on some pages, but there is no returns policy page. Google requires a clear return and refund policy.'
        : 'No returns or refund policy was found anywhere. Google requires one, even if your policy is that you do not accept returns.',
      fix: 'Add a Returns page that says how many days customers have, what condition items must be in, who pays return shipping, and how refunds are paid. Link it in the footer.',
      evidence: [],
    });
  }
  if ((anyEmail || anyPhone) && !has('contact')) {
    out.push({
      id: 'pages:no-contact-page',
      severity: 'low',
      area: 'pages',
      title: 'There is no Contact page',
      detail: 'Contact details appear on the site, but no page is dedicated to them. Reviewers often open the Contact page first.',
      fix: 'Add a Contact page with your email, phone, business name and address, and link it in the footer.',
      evidence: [],
    });
  }
  if (!pages.some((p) => p.addresses.length)) {
    out.push({
      id: 'pages:no-address',
      severity: 'low',
      area: 'contact',
      title: 'No business address was found',
      detail: 'No street address was found on the pages read. Merchant Center asks for a business address, and reviewers compare it with what the site shows.',
      fix: 'Show the same address you gave Merchant Center on your Contact page. If you work from home and do not want to publish it, check Google’s current guidance for your country before you request a review.',
      evidence: [],
    });
  }
  if (!has('terms')) {
    out.push({
      id: 'pages:no-terms',
      severity: 'low',
      area: 'pages',
      title: 'No terms of service page was found',
      detail: 'Not required by every country, but most stores that pass review have one, and it is where payment and billing terms belong.',
      fix: 'Add a Terms of Service page (most store builders have a template) and link it in the footer.',
      evidence: [],
    });
  }
  // Only "not found" counts as broken: a refusal (403, 429) is usually bot protection turning the checker away.
  const broken = errors.filter((e) => !e.guessed && isGone(e) && e.kind && ['contact', 'shipping', 'returns', 'terms', 'privacy', 'about'].includes(e.kind));
  if (broken.length) {
    out.push({
      id: 'pages:broken-policy-links',
      severity: 'high',
      area: 'pages',
      title: `${plural(broken.length, 'link')} to your policy or contact pages ${broken.length === 1 ? 'leads' : 'lead'} to an error`,
      detail: 'Your site links to these pages, but they did not open. A reviewer who clicks “Returns” and gets an error page sees a store without a returns policy.',
      fix: 'Open each link yourself. Fix or remove links to pages that no longer exist.',
      evidence: cap(broken.map((e) => ({ url: e.url, text: `${KIND_LABEL[e.kind ?? 'other']}: ${e.error}`, kind: 'note' as const }))),
    });
  }
}

// ---------------------------------------------------------------- contact

function contactChecks(pages: PageFacts[], settings: MerchantSettings | undefined, out: Finding[]): void {
  // Phones
  const phones = new Map<string, Evidence[]>();
  for (const p of pages) {
    for (const ph of p.phones) {
      const list = phones.get(ph.digits) ?? [];
      list.push({ url: p.url, text: ph.text });
      phones.set(ph.digits, list);
    }
  }
  if (phones.size > 1) {
    out.push({
      id: 'contact:phones',
      severity: 'medium',
      area: 'contact',
      title: `${phones.size} different phone numbers appear on your store`,
      detail: 'Different pages show different phone numbers. If one is old or belongs to an app or supplier, a reviewer cannot tell which is really yours.',
      fix: 'Use one phone number everywhere (footer, Contact page, policies) and make it the one in Merchant Center. If you really have two lines, label them (“Orders”, “Wholesale”).',
      evidence: cap([...phones.values()].map((list) => ({ url: list[0].url, text: `${list[0].text} (on ${plural(list.length, 'page')})` }))),
    });
  }
  const mcPhone = settings?.phone ? phoneKey(settings.phone) : null;
  if (mcPhone && phones.size && !phones.has(mcPhone)) {
    out.push({
      id: 'contact:mc-phone',
      severity: 'high',
      area: 'contact',
      title: 'The phone number you gave Merchant Center is not on your store',
      detail: `You entered ${settings?.phone} as your Merchant Center phone number, but the store shows a different one.`,
      fix: 'Make the number on the store and in Merchant Center (Business info) the same.',
      evidence: [{ url: MERCHANT_CENTER, text: settings?.phone ?? '' }, ...cap([...phones.values()].map((l) => l[0]))],
    });
  }

  // Emails
  const emails = new Map<string, Evidence[]>();
  for (const p of pages) {
    for (const e of p.emails) {
      const list = emails.get(e) ?? [];
      list.push({ url: p.url, text: e });
      emails.set(e, list);
    }
  }
  const domains = new Set([...emails.keys()].map((e) => e.split('@')[1]));
  const free = [...domains].filter((d) => FREE_MAIL.test(d));
  if (emails.size > 1 && domains.size > 1) {
    // A personal mailbox next to the store's own address looks like two businesses; two company domains usually do not.
    const mixed = free.length > 0 && free.length < domains.size;
    out.push({
      id: 'contact:emails',
      severity: mixed ? 'medium' : 'low',
      area: 'contact',
      title: mixed ? 'Your store shows both a personal and a business email address' : `Your store shows email addresses at ${domains.size} different domains`,
      detail: mixed
        ? `A store address on one page and a personal ${free.join(', ')} address on another can look like two different businesses.`
        : 'Different email domains (for example a separate wholesale company) are fine if a page says how they are related; otherwise a reviewer may wonder which business they are dealing with.',
      fix: 'Use one email address on your own domain everywhere, and the same one in Merchant Center.',
      evidence: cap([...emails.values()].map((list) => ({ url: list[0].url, text: `${list[0].text} (on ${plural(list.length, 'page')})` }))),
    });
  }
  const mcEmail = settings?.email?.trim().toLowerCase();
  if (mcEmail && emails.size && !emails.has(mcEmail)) {
    out.push({
      id: 'contact:mc-email',
      severity: 'medium',
      area: 'contact',
      title: 'The email address you gave Merchant Center is not on your store',
      detail: `You entered ${mcEmail}, but the store shows ${[...emails.keys()].slice(0, 3).join(', ')}.`,
      fix: 'Show the same email on the store as in Merchant Center, or change the one in Merchant Center.',
      evidence: [{ url: MERCHANT_CENTER, text: mcEmail }, ...cap([...emails.values()].map((l) => l[0]))],
    });
  }

  // Business names
  const names = new Map<string, Evidence[]>();
  for (const p of pages) {
    for (const n of p.names) {
      const k = nameKey(n.name);
      const list = names.get(k) ?? [];
      if (!list.some((x) => x.text.startsWith(n.name))) list.push({ url: p.url, text: `${n.name} (${n.source})` });
      names.set(k, list);
    }
  }
  const keys = [...names.keys()];
  const related = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);
  const groups: string[][] = [];
  for (const k of keys) {
    const g = groups.find((grp) => grp.some((x) => related(x, k)));
    if (g) g.push(k);
    else groups.push([k]);
  }
  if (groups.length > 1) {
    out.push({
      id: 'contact:names',
      severity: 'medium',
      area: 'contact',
      title: `Your store uses ${groups.length} different business names`,
      detail: 'The name in the footer, the site name and the name in your structured data do not agree. Google compares the business name across the site and Merchant Center.',
      fix: 'Pick one name and use it in the footer copyright line, the site name (Shopify: Settings > Store details) and Merchant Center. A shop name plus a legal name is fine if the About or Contact page says both.',
      evidence: cap(keys.flatMap((k) => (names.get(k) ?? []).slice(0, 2))),
    });
  }
  const mcName = settings?.businessName ? nameKey(settings.businessName) : '';
  if (mcName && keys.length && !keys.some((k) => related(k, mcName))) {
    out.push({
      id: 'contact:mc-name',
      severity: 'high',
      area: 'contact',
      title: 'The business name in Merchant Center does not appear on your store',
      detail: `You entered “${settings?.businessName}”, but the store calls itself ${keys.slice(0, 3).map((k) => `“${names.get(k)?.[0].text.replace(/ \(.*\)$/, '')}”`).join(', ')}.`,
      fix: 'Make the store name in Merchant Center (Business info) match the name on the site, or add the Merchant Center name to your About and Contact pages.',
      evidence: [{ url: MERCHANT_CENTER, text: settings?.businessName ?? '' }, ...cap(keys.map((k) => (names.get(k) ?? [])[0]))],
    });
  }

  // Addresses
  const codes = new Map<string, Evidence[]>();
  for (const p of pages) {
    for (const a of p.addresses) {
      if (!a.postcode) continue;
      const list = codes.get(a.postcode) ?? [];
      list.push({ url: p.url, text: a.text });
      codes.set(a.postcode, list);
    }
  }
  if (codes.size > 1) {
    out.push({
      id: 'contact:addresses',
      severity: 'medium',
      area: 'contact',
      title: `Addresses with ${codes.size} different postcodes appear on your store`,
      detail: 'More than one business address appears. If one is a returns warehouse or an old address, a reviewer cannot tell from the page.',
      fix: 'Use one business address everywhere. If returns go to a different address, label it “Returns address” on the returns page.',
      evidence: cap([...codes.values()].map((l) => l[0])),
    });
  }
  const mcPost = settings?.postcode ? (postcodeOf(settings.postcode) ?? settings.postcode.replace(/\s+/g, '').toUpperCase()) : '';
  if (mcPost && codes.size && !codes.has(mcPost)) {
    out.push({
      id: 'contact:mc-address',
      severity: 'medium',
      area: 'contact',
      title: 'The address you gave Merchant Center is not on your store',
      detail: `You entered postcode ${settings?.postcode}, but the addresses on the store use ${[...codes.keys()].join(', ')}.`,
      fix: 'Show the Merchant Center address on your Contact page, or correct it in Merchant Center.',
      evidence: [{ url: MERCHANT_CENTER, text: settings?.postcode ?? '' }, ...cap([...codes.values()].map((l) => l[0]))],
    });
  }
}

// ---------------------------------------------------------------- shipping

type Located = ShippingClaim & { url: string; kind: PageFacts['kind'] };

function distinctRanges(list: Located[]): Located[] {
  const out: Located[] = [];
  for (const c of list) if (!out.some((x) => x.min === c.min && x.max === c.max && x.url === c.url)) out.push(c);
  return out;
}

function shippingChecks(pages: PageFacts[], feed: Feed | undefined, settings: MerchantSettings | undefined, out: Finding[]): void {
  const claims: Located[] = pages.flatMap((p) => p.shipping.map((c) => ({ ...c, url: p.url, kind: p.kind })));
  const stageWord = { processing: 'handling (time before an order ships)', delivery: 'delivery time' } as const;
  for (const stage of ['processing', 'delivery'] as const) {
    for (const speed of ['standard', 'express', 'international'] as const) {
      const group = distinctRanges(claims.filter((c) => c.stage === stage && c.speed === speed));
      const clash = group.some((a) => group.some((b) => a.url !== b.url && !overlaps(a, b)));
      if (!clash) continue;
      const policy = group.some((c) => c.kind === 'shipping');
      const ranges = [...new Set(group.map((c) => formatRange(c)))];
      out.push({
        id: `shipping:${stage}:${speed}`,
        severity: policy ? 'high' : 'medium',
        area: 'shipping',
        title: `Your ${speed === 'standard' ? '' : `${speed} `}${stageWord[stage]} is stated in different ways across your store`,
        detail: `Pages give ${joinAnd(ranges)}. A shopper (or reviewer) reading two of these pages gets two different promises.`,
        fix: 'Decide on one range and use it everywhere: the shipping policy, product pages, FAQ, banners and Merchant Center shipping settings. Search your theme and apps for the old wording.',
        evidence: cap(byValue(group, (c) => formatRange(c))),
      });
    }
  }

  // Feed and Merchant Center versus the site's standard shipping.
  const compare = (source: string, handling: DayRange | undefined, transit: DayRange | undefined, idSuffix: string) => {
    const proc = claims.filter((c) => c.stage === 'processing' && c.speed === 'standard');
    if (handling && proc.length && !proc.some((c) => overlaps(c, handling))) {
      out.push({
        id: `shipping:handling-vs-${idSuffix}`,
        severity: 'high',
        area: 'shipping',
        title: `${source} says orders ship in ${formatRange(handling)}; your store says otherwise`,
        detail: `${source} gives a handling time of ${formatRange(handling)}, but the store says ${joinAnd([...new Set(proc.map((c) => formatRange(c)))])}.`,
        fix: 'Change the handling time in Merchant Center shipping settings (or the feed) to match the store, or update the store.',
        evidence: [{ url: source, text: `Handling ${formatRange(handling)}`, kind: 'note' }, ...cap(byValue(proc, (c) => formatRange(c)))],
      });
    }
    const deliv = claims.filter((c) => c.stage === 'delivery' && c.speed === 'standard');
    if (transit && deliv.length) {
      const total = { min: transit.min, max: transit.max + (handling?.max ?? 0) };
      if (!deliv.some((c) => overlaps(c, transit) || overlaps(c, total))) {
        out.push({
          id: `shipping:transit-vs-${idSuffix}`,
          severity: 'high',
          area: 'shipping',
          title: `${source} says delivery takes ${formatRange(transit)}; your store says otherwise`,
          detail: `${source} gives a transit time of ${formatRange(transit)}, but the store says ${joinAnd([...new Set(deliv.map((c) => formatRange(c)))])}.`,
          fix: 'Make the transit time in Merchant Center shipping settings match the delivery time on the store.',
          evidence: [{ url: source, text: `Transit ${formatRange(transit)}`, kind: 'note' }, ...cap(byValue(deliv, (c) => formatRange(c)))],
        });
      }
    }
  };
  if (feed) {
    const mostCommon = (ranges: Array<DayRange | undefined>): DayRange | undefined => {
      const counts = new Map<string, { r: DayRange; n: number }>();
      for (const r of ranges) {
        if (!r) continue;
        const k = `${r.min}-${r.max}`;
        const e = counts.get(k) ?? { r, n: 0 };
        e.n++;
        counts.set(k, e);
      }
      return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.r;
    };
    compare('Your product feed', mostCommon(feed.items.map((i) => i.handling)), mostCommon(feed.items.map((i) => i.transit)), 'feed');
  }
  if (settings) compare(MERCHANT_CENTER, settings.handlingDays, settings.transitDays, 'mc');

  // Free-shipping thresholds
  const free = new Map<string, Evidence[]>();
  for (const p of pages) {
    for (const f of p.freeShipping) {
      const k = `${f.currency} ${f.threshold}`;
      const list = free.get(k) ?? [];
      if (!list.some((e) => e.url === p.url)) list.push({ url: p.url, text: f.text });
      free.set(k, list);
    }
  }
  if (free.size > 1) {
    out.push({
      id: 'shipping:free-threshold',
      severity: 'medium',
      area: 'shipping',
      title: `The free-shipping minimum is stated as ${free.size} different amounts`,
      detail: `Pages give ${joinAnd([...free.keys()].map((k) => k.trim()))} as the order value for free shipping. This often comes from an old announcement bar or an app setting.`,
      fix: 'Use one threshold on every page, in the announcement bar and in Merchant Center shipping settings.',
      evidence: cap(byValue([...free.entries()].flatMap(([k, list]) => list.map((e) => ({ ...e, k }))), (e) => e.k)),
    });
  }
}

// ---------------------------------------------------------------- returns

function returnChecks(pages: PageFacts[], settings: MerchantSettings | undefined, out: Finding[]): void {
  const windows = pages.flatMap((p) => p.returns.filter((r) => !r.noReturns).map((r) => ({ ...r, url: p.url })));
  const none = pages.flatMap((p) => p.returns.filter((r) => r.noReturns).map((r) => ({ ...r, url: p.url })));
  const days = [...new Set(windows.map((w) => w.days))].sort((a, b) => a - b);
  if (days.length > 1) {
    out.push({
      id: 'returns:windows',
      severity: 'high',
      area: 'returns',
      title: `Your return window is stated as ${joinAnd(days)} days on different pages`,
      detail: 'Different pages give customers a different number of days to return an item. Inconsistent return terms are one of the most common Misrepresentation findings.',
      fix: 'Pick one return window and use it on the returns policy, FAQ, product pages, footer badges and in Merchant Center return settings.',
      evidence: cap(byValue(windows, (w) => String(w.days))),
    });
  }
  if (none.length && windows.length) {
    out.push({
      id: 'returns:none-vs-window',
      severity: 'high',
      area: 'returns',
      title: 'One page says you take no returns, another offers a return window',
      detail: 'A page says sales are final or that returns are not accepted, while another promises a return period.',
      fix: 'If some items cannot be returned (sale, custom, hygiene), say which ones. Otherwise remove the “no returns” wording.',
      evidence: cap(byValue([...none, ...windows], (w) => (w.noReturns ? 'none' : String(w.days)))),
    });
  }
  if (settings?.returnDays && windows.length && !days.includes(settings.returnDays)) {
    out.push({
      id: 'returns:mc',
      severity: 'high',
      area: 'returns',
      title: `Merchant Center says ${settings.returnDays} days for returns; your store says ${days.join(' or ')}`,
      detail: 'The return window set in Merchant Center (Settings > Returns) differs from the one on the store.',
      fix: 'Make the two match. The policy page on the store is what reviewers read.',
      evidence: [{ url: MERCHANT_CENTER, text: `${settings.returnDays}-day returns`, kind: 'note' }, ...cap(byValue(windows, (w) => String(w.days)))],
    });
  }
}

// ---------------------------------------------------------------- products

function productChecks(pages: PageFacts[], out: Finding[]): void {
  const priceMismatch: Evidence[] = [];
  const tagMismatch: Evidence[] = [];
  const stockMismatch: Evidence[] = [];
  const dupConflict: Evidence[] = [];
  const dupSame: Evidence[] = [];
  const noData: Evidence[] = [];
  for (const p of pages) {
    const data = p.offers.filter((o) => o.source === 'structured data');
    // Everything this check lists is the checker's own description of the page.
    const tag = p.offers.find((o) => o.source === 'page price tag');
    const seen = p.offers.find((o) => o.source === 'page text');
    if (p.kind === 'product' && !data.length) noData.push({ url: p.url, text: p.title || 'Product page' });
    if (seen?.price !== undefined && p.structuredPrices.length && !p.structuredPrices.some((x) => near(x, seen.price as number))) {
      priceMismatch.push({ url: p.url, text: `Shoppers see ${money(seen.price, seen.currency)}; structured data says ${money(p.structuredPrices[0], data[0]?.currency)}` });
    }
    if (tag?.price !== undefined && p.structuredPrices.length && !p.structuredPrices.some((x) => near(x, tag.price as number))) {
      tagMismatch.push({ url: p.url, text: `Price tag ${money(tag.price, tag.currency)}; structured data ${money(p.structuredPrices[0], data[0]?.currency)}` });
    }
    const dataStock = data.find((o) => o.availability)?.availability;
    if (seen?.availability && dataStock && seen.availability !== dataStock && (seen.availability === 'out of stock' || dataStock === 'out of stock')) {
      stockMismatch.push({ url: p.url, text: `The page shows “${seen.availability}”; structured data says “${dataStock}”` });
    }
    if (p.productSchemaCount > 1) {
      const prices = new Set(data.map((o) => o.price).filter((x) => x !== undefined));
      const names = new Set(data.map((o) => o.name?.toLowerCase()).filter(Boolean));
      const text = `${p.productSchemaCount} product data blocks${prices.size > 1 ? ` with prices ${[...prices].map((x) => money(x as number)).join(' and ')}` : ''}`;
      if (prices.size > 1 || names.size > 1) dupConflict.push({ url: p.url, text });
      else dupSame.push({ url: p.url, text });
    }
  }
  for (const list of [priceMismatch, tagMismatch, stockMismatch, dupConflict, dupSame, noData]) for (const e of list) e.kind = 'note';
  const n = (e: Evidence[]) => plural(e.length, 'product page');
  if (priceMismatch.length) {
    out.push({
      id: 'price:visible-vs-data',
      severity: 'high',
      area: 'price',
      title: `On ${n(priceMismatch)}, the price shoppers see differs from the price in the page’s product data`,
      detail: 'Google reads the product data hidden in the page and compares it with your feed and with what shoppers see. A different price is treated as misleading.',
      fix: 'This usually comes from a theme or app that writes its own product data, or a sale price that is not in the data. Check with your theme or SEO app; Google’s Rich Results Test shows what Google reads.',
      evidence: cap(priceMismatch),
    });
  }
  if (stockMismatch.length) {
    out.push({
      id: 'stock:visible-vs-data',
      severity: 'high',
      area: 'stock',
      title: `On ${n(stockMismatch)}, stock shown to shoppers differs from the product data`,
      detail: 'The page says one thing about availability and the product data says another.',
      fix: 'Make sure the product data updates when items sell out. A theme or SEO app is usually the cause.',
      evidence: cap(stockMismatch),
    });
  }
  if (dupConflict.length) {
    out.push({
      id: 'data:duplicate-conflict',
      severity: 'high',
      area: 'data',
      title: `${n(dupConflict)} ${carry(dupConflict.length)} two sets of product data that disagree`,
      detail: 'When a theme and an app both add product data, Google may read the wrong one. Here the copies give different prices or names.',
      fix: 'Turn off the product data in either the theme or the app (often an SEO or reviews app) so each page has one set.',
      evidence: cap(dupConflict),
    });
  }
  if (tagMismatch.length) {
    out.push({
      id: 'price:tag-vs-data',
      severity: 'medium',
      area: 'price',
      title: `On ${n(tagMismatch)}, the sharing price tag differs from the product data`,
      detail: 'The price in the page head (used when the link is shared) does not match the product data.',
      fix: 'Usually a theme setting or an old app. Check after the price in the product data is fixed.',
      evidence: cap(tagMismatch),
    });
  }
  if (dupSame.length) {
    out.push({
      id: 'data:duplicate',
      severity: 'low',
      area: 'data',
      title: `${n(dupSame)} ${carry(dupSame.length)} two copies of the same product data`,
      detail: 'The copies agree today, but they can drift apart when one of them stops updating.',
      fix: 'Keep the theme’s product data or the app’s, not both.',
      evidence: cap(dupSame),
    });
  }
  if (noData.length) {
    out.push({
      id: 'data:missing',
      severity: 'low',
      area: 'data',
      title: `${n(noData)} ${have(noData.length)} no product data Google can read`,
      detail: 'Without product data, Google has to guess the price and stock from the page, and it compares that guess with your feed.',
      fix: 'Most themes add product data automatically; if yours does not, a structured-data app can.',
      evidence: cap(noData),
    });
  }
}

// ---------------------------------------------------------------- feed

function feedChecks(pages: PageFacts[], errors: PageError[], feed: Feed, out: Finding[]): void {
  const byKey = new Map(pages.map((p) => [pageKey(p.url), p]));
  const errByKey = new Map(errors.map((e) => [pageKey(e.url), e]));
  const site = pages[0]?.url;
  const priceOff: Evidence[] = [];
  const stockOff: Evidence[] = [];
  const currencyOff: Evidence[] = [];
  const broken: Evidence[] = [];
  const offsite: Evidence[] = [];
  for (const item of feed.items) {
    if (!item.link) continue;
    const label = `Feed row ${item.row}${item.title ? ` (${item.title})` : ''}`;
    if (site && pageKey(item.link).split('/')[0] !== pageKey(site).split('/')[0]) {
      offsite.push({ url: item.link, text: label });
      continue;
    }
    const key = pageKey(item.link);
    const err = errByKey.get(key);
    if (err && isGone(err)) {
      broken.push({ url: item.link, text: `${label}: ${err.error}` });
      continue;
    }
    const page = byKey.get(key);
    if (!page) continue;
    const seen = page.offers.find((o) => o.source === 'page text');
    const pagePrices = [...page.structuredPrices, ...(seen?.price !== undefined ? [seen.price] : [])];
    const feedPrice = item.salePrice ?? item.price;
    if (feedPrice !== undefined && pagePrices.length && !pagePrices.some((x) => near(x, feedPrice))) {
      priceOff.push({ url: page.url, text: `${label}: feed says ${money(feedPrice, item.currency)}, page says ${money(seen?.price ?? pagePrices[0], seen?.currency ?? page.offers.find((o) => o.currency)?.currency ?? item.currency)}` });
    }
    const pageStock = seen?.availability ?? page.offers.find((o) => o.availability)?.availability;
    if (item.availability && pageStock && item.availability !== pageStock && (item.availability === 'out of stock' || pageStock === 'out of stock')) {
      stockOff.push({ url: page.url, text: `${label}: feed says “${item.availability}”, page says “${pageStock}”` });
    }
    const pageCur = page.offers.find((o) => o.currency)?.currency?.toUpperCase();
    if (item.currency && pageCur && item.currency !== pageCur) {
      currencyOff.push({ url: page.url, text: `${label}: feed in ${item.currency}, page in ${pageCur}` });
    }
  }
  for (const list of [priceOff, stockOff, currencyOff, broken, offsite]) for (const e of list) e.kind = 'note';
  const rows = (e: Evidence[]) => plural(e.length, 'product');
  if (priceOff.length) {
    out.push({
      id: 'feed:price',
      severity: 'high',
      area: 'price',
      title: `${rows(priceOff)} in your feed ${have(priceOff.length)} a different price from the product page`,
      detail: 'Google compares the feed price with the landing page. A mismatch is one of the most common reasons for product disapprovals and Misrepresentation reviews.',
      fix: 'Re-sync the feed from your store (or fix the price in the feed app), then check that sale prices are sent as sale_price.',
      evidence: cap(priceOff),
    });
  }
  if (stockOff.length) {
    out.push({
      id: 'feed:stock',
      severity: 'high',
      area: 'stock',
      title: `${rows(stockOff)} ${are(stockOff.length)} in stock in one place and sold out in the other`,
      detail: 'The feed and the product page disagree about availability.',
      fix: 'Make sure the feed updates at least daily, and that sold-out items are sent as out_of_stock.',
      evidence: cap(stockOff),
    });
  }
  if (broken.length) {
    out.push({
      id: 'feed:broken-links',
      severity: 'high',
      area: 'pages',
      title: `${plural(broken.length, 'feed link')} ${broken.length === 1 ? 'does' : 'do'} not open a working page`,
      detail: 'These products send shoppers to pages that did not load.',
      fix: 'Remove deleted products from the feed, or fix the links.',
      evidence: cap(broken),
    });
  }
  if (currencyOff.length) {
    out.push({
      id: 'feed:currency',
      severity: 'medium',
      area: 'price',
      title: `${rows(currencyOff)} ${are(currencyOff.length)} priced in a different currency in the feed`,
      detail: 'The feed and the page show prices in different currencies.',
      fix: 'Send the feed in the currency the landing page shows, or use a country-specific feed and landing page.',
      evidence: cap(currencyOff),
    });
  }
  if (offsite.length) {
    out.push({
      id: 'feed:other-site',
      severity: 'medium',
      area: 'pages',
      title: `${plural(offsite.length, 'feed link')} ${offsite.length === 1 ? 'points' : 'point'} to a different website`,
      detail: 'Feed links must lead to the store you verified in Merchant Center.',
      fix: 'Change the links to your store’s own product pages.',
      evidence: cap(offsite),
    });
  }
}

// ---------------------------------------------------------------- wording

function wordingChecks(pages: PageFacts[], out: Finding[]): void {
  for (const rule of CLAIM_RULES) {
    const hits = pages.flatMap((p) => p.risky.filter((r) => r.ruleId === rule.id).map((r) => ({ url: p.url, text: r.text })));
    if (!hits.length) continue;
    out.push({
      id: `wording:${rule.id}`,
      severity: ['authorized', 'health', 'guaranteed-results', 'just-pay-shipping'].includes(rule.id) ? 'medium' : 'low',
      area: 'wording',
      title: `${rule.label} on ${plural(new Set(hits.map((h) => h.url)).size, 'page')}`,
      detail: rule.why,
      fix: rule.fix,
      evidence: cap(hits),
    });
  }
}

/** Run every check and return the findings, most serious first. */
export function runChecks(input: CheckInput): Finding[] {
  const out: Finding[] = [];
  const readable = input.pages.filter((p) => !p.blocked && p.status < 400);
  const blocked = input.pages.filter((p) => p.blocked);
  const locked = blocked.find((p) => /password/i.test(p.blocked ?? ''));
  if (locked) {
    out.push({
      id: 'pages:password',
      severity: 'high',
      area: 'pages',
      title: 'Your store is password protected',
      detail: locked.blocked ?? '',
      fix: 'Remove the storefront password, then run this check again before requesting a review.',
      evidence: [{ url: locked.url, text: locked.title || 'Password page' }],
    });
  } else if (blocked.length) {
    out.push({
      id: 'pages:bot-wall',
      severity: 'low',
      area: 'pages',
      title: `${plural(blocked.length, 'page')} could not be read because of bot protection`,
      detail: 'Your store’s security service answered instead of the page. Google’s own crawler is usually let through, so this is not necessarily a problem for your review, but these pages were not checked.',
      fix: 'If you use a firewall or bot-protection app, check that it allows Googlebot and Google-InspectionTool.',
      evidence: cap(blocked.map((p) => ({ url: p.url, text: p.blocked ?? '', kind: 'note' as const }))),
    });
  }
  if (!readable.length) return out;
  pageChecks(readable, input.errors, out);
  contactChecks(readable, input.settings, out);
  shippingChecks(readable, input.feed, input.settings, out);
  returnChecks(readable, input.settings, out);
  productChecks(readable, out);
  if (input.feed?.items.length) feedChecks(readable, input.errors, input.feed, out);
  wordingChecks(readable, out);
  return out
    .map((f) => ({ ...f, evidence: f.evidence.map((e) => ({ ...e, text: e.text || shortUrl(e.url) })) }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || AREA_RANK[a.area] - AREA_RANK[b.area]);
}
