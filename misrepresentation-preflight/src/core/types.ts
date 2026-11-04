export type Platform = 'Shopify' | 'WooCommerce' | 'Wix' | 'Squarespace' | 'BigCommerce';

/** What kind of page this is, judged from its address and title. */
export type PageKind =
  | 'home'
  | 'contact'
  | 'about'
  | 'shipping'
  | 'returns'
  | 'terms'
  | 'privacy'
  | 'faq'
  | 'product'
  | 'listing'
  | 'other';

/** A number of days, as a range ("3-5 business days" is {min: 3, max: 5, business: true}). */
export interface DayRange {
  min: number;
  max: number;
  business: boolean;
}

/** A shipping time the page states, with the sentence it came from. */
export interface ShippingClaim extends DayRange {
  /** "processing" = time before it ships; "delivery" = time to arrive. */
  stage: 'processing' | 'delivery';
  /** Shipping speed the sentence talks about; only like is compared with like. */
  speed: 'standard' | 'express' | 'international';
  text: string;
}

/** A return window the page states ("30-day returns"), or a no-returns statement (days 0). */
export interface ReturnClaim {
  days: number;
  noReturns: boolean;
  text: string;
}

/** "Free shipping on orders over $50". */
export interface FreeShippingClaim {
  threshold: number;
  currency: string;
  text: string;
}

/** A product offer read from one source on a product page. */
export interface Offer {
  source: 'structured data' | 'page price tag' | 'page text';
  name?: string;
  sku?: string;
  price?: number;
  currency?: string;
  availability?: Availability;
}

export type Availability = 'in stock' | 'out of stock' | 'preorder' | 'backorder';

/** A wording Google's reviewers treat with suspicion, found on a page. */
export interface RiskyClaim {
  ruleId: string;
  phrase: string;
  text: string;
}

/** Everything the checker reads from one page. Sent from the server as JSON. */
export interface PageFacts {
  url: string;
  status: number;
  kind: PageKind;
  title: string;
  /** Same-site links found on the page, absolute, for finding more pages. */
  links: Array<{ url: string; text: string }>;
  emails: string[];
  phones: Array<{ digits: string; text: string }>;
  names: Array<{ name: string; source: string }>;
  addresses: Array<{ text: string; postcode?: string; source: string }>;
  shipping: ShippingClaim[];
  returns: ReturnClaim[];
  freeShipping: FreeShippingClaim[];
  offers: Offer[];
  /** Every price the page's structured data gives, variants included. */
  structuredPrices: number[];
  /** How many separate Product structured-data blocks the page carries. */
  productSchemaCount: number;
  risky: RiskyClaim[];
  /** The store builder, when the page gives it away. */
  platform?: Platform;
  /** Set when the page is not a normal store page (bot wall, password page). */
  blocked?: string;
}

/** A page the checker tried but could not read. */
export interface PageError {
  url: string;
  error: string;
  status?: number;
  /** The kind of page the link was expected to be. */
  kind?: PageKind;
  /** True for addresses the checker tried on its own (a platform's usual policy address), not links on the site. */
  guessed?: boolean;
}

/** One row of the owner's product feed. */
export interface FeedItem {
  id: string;
  title: string;
  link: string;
  price?: number;
  salePrice?: number;
  currency?: string;
  availability?: Availability;
  /** Handling (processing) days from the feed, when present. */
  handling?: DayRange;
  /** Transit (delivery) days from the feed, when present. */
  transit?: DayRange;
  row: number;
}

export interface Feed {
  items: FeedItem[];
  warnings: string[];
  format: 'csv' | 'tsv' | 'xml';
}

/** What the owner told Google Merchant Center, typed in by hand (all optional). */
export interface MerchantSettings {
  businessName?: string;
  phone?: string;
  email?: string;
  postcode?: string;
  returnDays?: number;
  handlingDays?: DayRange;
  transitDays?: DayRange;
}

export type Severity = 'high' | 'medium' | 'low';

export type Area = 'contact' | 'shipping' | 'returns' | 'price' | 'stock' | 'data' | 'wording' | 'pages';

export interface Evidence {
  url: string;
  text: string;
  /** "note" = the checker's own description, not words quoted from the page. */
  kind?: 'quote' | 'note';
}

/** One thing a reviewer could see as the store contradicting itself. */
export interface Finding {
  /** Stable across runs, so the re-check log can say what was fixed. */
  id: string;
  severity: Severity;
  area: Area;
  title: string;
  detail: string;
  fix: string;
  evidence: Evidence[];
}

export interface ScanResult {
  site: string;
  checkedAt: string;
  pages: PageFacts[];
  errors: PageError[];
  skippedByRobots: string[];
  /** Policy and contact pages read although robots.txt asks crawlers to skip them (the owner confirmed the store is theirs). */
  readDespiteRobots: string[];
  feed?: { items: number; format: string; warnings: string[] };
  findings: Finding[];
}
