/**
 * The marketplace's seller rules as data, and the check that applies them to
 * one resource. Teachers Pay Teachers (TPT) has two seller tiers from
 * 1 January 2027:
 *
 * - Exclusive: some product types may not be sold anywhere but TPT.
 * - Basic: sell anywhere, but TPT buyers must not pay more than elsewhere,
 *   and nothing may cost money on TPT that is free elsewhere.
 *
 * Every rule names its source. Checked 2026-11-11: TPT's seller blog post
 * (fetched) gives the Exclusive table word for word; the help-center articles
 * refused automated fetching, so the Basic price wording comes from a search
 * snippet of article 360044219551 and is marked unconfirmed below. Re-check
 * both when the rule watch (milestone 5) reports a change.
 */
import type { Listing, Resource, StoreId } from './types';

export const RULES_CHECKED = '2026-11-11';

export const SOURCES = {
  exclusiveTable: {
    title: 'TPT seller blog: the Exclusive Seller membership (1 October 2026)',
    url: 'https://sellerblog.teacherspayteachers.com/tpt-exclusive-seller/',
    confirmed: true,
  },
  exclusiveHelp: {
    title: 'TPT help: What kinds of products can I sell outside of TPT as an Exclusive Seller?',
    url: 'https://help.teacherspayteachers.com/hc/en-us/articles/54095615314324-What-kinds-of-products-can-I-sell-outside-of-TPT-as-an-Exclusive-Seller',
    confirmed: false,
  },
  otherSites: {
    title: 'TPT help: Guidelines around utilizing other sites',
    url: 'https://help.teacherspayteachers.com/hc/en-us/articles/360044219551-Guidelines-around-utilizing-other-sites',
    confirmed: false,
  },
} as const;

/** The key dates, from the seller blog. */
export const DATES = {
  exclusiveDeadline: '2026-12-31',
  basicConversion: '2027-01-01',
} as const;

/** Whether an Exclusive seller may sell this type outside TPT. */
export type OffTpt = 'yes' | 'no' | 'own-platform' | 'unknown';

export interface ProductType {
  id: string;
  label: string;
  /** What sellers call it, to help them pick. */
  examples: string;
  offTpt: OffTpt;
  /** For 'own-platform': the stores where it may be sold. */
  allowedStores?: readonly StoreId[];
  /** The row of the Exclusive table this type follows, word for word. */
  rule: string;
}

export const PRODUCT_TYPES = [
  {
    id: 'digital-education',
    label: 'Digital teaching resource',
    examples: 'worksheets, lesson plans, task cards, slides, units, printables, digital activities',
    offTpt: 'no',
    rule: 'Digital education resources: not permitted off TPT as an Exclusive Seller.',
  },
  {
    id: 'license',
    label: 'Licence to a teaching resource',
    examples: 'school, district or multi-classroom licences',
    offTpt: 'no',
    rule: 'Digital education resource licenses: not permitted off TPT as an Exclusive Seller.',
  },
  {
    id: 'membership',
    label: 'Membership with your resources',
    examples: 'a resource club or subscription that gives access to your resources',
    offTpt: 'no',
    rule: 'Memberships that include access to your digital education resources: not permitted off TPT as an Exclusive Seller.',
  },
  {
    id: 'non-teaching-digital',
    label: 'Clip art, fonts (not for teaching)',
    examples: 'clip art, fonts, borders, templates for other sellers',
    offTpt: 'yes',
    rule: 'Digital resources unrelated to education / teaching (ex: clip art, fonts): permitted off TPT.',
  },
  {
    id: 'physical',
    label: 'Physical product',
    examples: 'printed workbooks, card decks, posters you post to buyers',
    offTpt: 'yes',
    rule: 'Physical products: permitted off TPT.',
  },
  {
    id: 'course',
    label: 'Course or professional development',
    examples: 'video courses, PD workshops for teachers',
    offTpt: 'yes',
    rule: 'Courses / professional development: permitted off TPT.',
  },
  {
    id: 'boom-cards',
    label: 'Boom Cards deck',
    examples: 'self-checking decks on Boom Learning',
    offTpt: 'own-platform',
    allowedStores: ['boom'],
    rule: 'Boom Cards: permitted off TPT (sellers read this as on Boom Learning itself).',
  },
  {
    id: 'kindle',
    label: 'Kindle book',
    examples: 'an ebook published through Amazon KDP',
    offTpt: 'own-platform',
    allowedStores: ['amazon-kdp'],
    rule: 'Kindle books: permitted off TPT.',
  },
  {
    id: 'other-digital',
    label: 'Not sure / something else',
    examples: 'pick this when no other type fits; the app will ask you to check it',
    offTpt: 'unknown',
    rule: 'Not in the Exclusive table: check with TPT before selling it elsewhere.',
  },
] as const satisfies readonly ProductType[];

export type ProductTypeId = (typeof PRODUCT_TYPES)[number]['id'];

export function productType(id: ProductTypeId): ProductType {
  return PRODUCT_TYPES.find((t) => t.id === id) ?? PRODUCT_TYPES[PRODUCT_TYPES.length - 1];
}

export type Severity = 'conflict' | 'check' | 'note';

export interface Finding {
  severity: Severity;
  /** Stable code, for tests and for counting in the catalog summary. */
  code:
    | 'exclusive-not-allowed'
    | 'exclusive-own-site-checkout'
    | 'exclusive-wrong-platform'
    | 'exclusive-unknown-type'
    | 'exclusive-price-missing'
    | 'free-elsewhere'
    | 'basic-lower-elsewhere'
    | 'basic-higher-elsewhere'
    | 'price-missing';
  store?: StoreId;
  message: string;
}

export interface ResourceCheck {
  exclusive: Finding[];
  basic: Finding[];
}

function storeName(l: Listing, labels: (s: StoreId) => string): string {
  return labels(l.store);
}

const money = (c: number) => (c === 0 ? 'free' : `$${(c / 100).toFixed(2)}`);

/**
 * Exclusive: the type decides where it may be sold. A free listing of a
 * digital teaching resource is allowed ("Exclusive Sellers may offer free
 * digital education resources on and off of TPT").
 */
function exclusiveFindings(r: Resource, labels: (s: StoreId) => string): Finding[] {
  const type = productType(r.productType);
  const out: Finding[] = [];
  for (const l of r.listings) {
    const name = storeName(l, labels);
    if (type.offTpt === 'yes') continue;
    if (type.offTpt === 'unknown') {
      out.push({ severity: 'check', code: 'exclusive-unknown-type', store: l.store, message: `Pick a product type to know whether it may stay on ${name}.` });
      continue;
    }
    if (type.offTpt === 'own-platform') {
      if (!type.allowedStores?.includes(l.store)) {
        out.push({ severity: 'check', code: 'exclusive-wrong-platform', store: l.store, message: `${type.label}s are allowed off TPT, but selling one as a file on ${name} may count as a digital teaching resource. Check before 31 December.` });
      }
      continue;
    }
    if (l.priceCents === 0) continue;
    if (l.priceCents === null) {
      out.push({ severity: 'check', code: 'exclusive-price-missing', store: l.store, message: `Enter the price on ${name}: Exclusive allows it there only if it is free.` });
      continue;
    }
    if (l.store === 'own-site') {
      out.push({ severity: 'conflict', code: 'exclusive-own-site-checkout', store: l.store, message: `Exclusive does not allow selling this on your own website. You may keep the page if its Buy button goes to your TPT store, or offer it free.` });
    } else {
      out.push({ severity: 'conflict', code: 'exclusive-not-allowed', store: l.store, message: `Exclusive does not allow selling a ${type.label.toLowerCase()} on ${name}. Remove it there, make it free there, or stay on Basic.` });
    }
  }
  return out;
}

/**
 * Basic: TPT buyers must not pay more than buyers elsewhere. A higher price
 * elsewhere does not hurt TPT buyers, so it is a note: the help article's
 * wording ("keep your prices consistent") is not confirmed word for word.
 */
function basicFindings(r: Resource, labels: (s: StoreId) => string): Finding[] {
  const out: Finding[] = [];
  const tpt = r.tptPriceCents;
  if (tpt === null) return out;
  for (const l of r.listings) {
    const name = storeName(l, labels);
    if (l.priceCents === null) {
      out.push({ severity: 'check', code: 'price-missing', store: l.store, message: `Enter the price on ${name} to compare it with TPT.` });
    } else if (l.priceCents < tpt) {
      out.push({ severity: 'conflict', code: 'basic-lower-elsewhere', store: l.store, message: `TPT buyers pay ${money(tpt)} but ${name} charges ${money(l.priceCents)}. Basic asks you to keep prices consistent: raise ${name} to ${money(tpt)} or lower TPT.` });
    } else if (l.priceCents > tpt) {
      out.push({ severity: 'note', code: 'basic-higher-elsewhere', store: l.store, message: `${name} charges more than TPT (${money(l.priceCents)} against ${money(tpt)}). TPT buyers do not pay more, but the rule asks for consistent prices.` });
    }
  }
  return out;
}

/** Both tiers: nothing may cost money on TPT that is free elsewhere. */
function freeElsewhere(r: Resource, labels: (s: StoreId) => string): Finding[] {
  if (r.tptPriceCents === null || r.tptPriceCents === 0) return [];
  return r.listings
    .filter((l) => l.priceCents === 0)
    .map((l) => ({
      severity: 'conflict' as const,
      code: 'free-elsewhere' as const,
      store: l.store,
      message: `It is free on ${storeName(l, labels)} but ${money(r.tptPriceCents ?? 0)} on TPT. TPT does not allow charging for a resource you give away elsewhere.`,
    }));
}

export function checkResource(r: Resource, labels: (s: StoreId) => string = (s) => s): ResourceCheck {
  const free = freeElsewhere(r, labels);
  // Basic's lower-price finding already covers a free listing; keep one finding per store.
  const basic = basicFindings(r, labels).filter((f) => !(f.code === 'basic-lower-elsewhere' && free.some((x) => x.store === f.store)));
  return { exclusive: [...exclusiveFindings(r, labels), ...free], basic: [...basic, ...free] };
}

export type Verdict = 'ok' | 'note' | 'check' | 'conflict';

export function verdict(findings: readonly Finding[]): Verdict {
  if (findings.some((f) => f.severity === 'conflict')) return 'conflict';
  if (findings.some((f) => f.severity === 'check')) return 'check';
  if (findings.some((f) => f.severity === 'note')) return 'note';
  return 'ok';
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  ok: 'Allowed',
  note: 'Allowed, with a note',
  check: 'Check this',
  conflict: 'Breaks the rules',
};
