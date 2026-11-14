/** Shared types of the delivery-email check. */
import type { SeedOrigin } from './seedwhere';

export type Placement = 'inbox' | 'promotions' | 'spam' | 'other' | 'unknown';
export type Severity = 'fail' | 'warn' | 'ok' | 'info';
export type Verdict = 'pass' | 'warn' | 'fail';

/** One authentication method's result as the receiving server recorded it. */
export interface AuthResult {
  method: 'spf' | 'dkim' | 'dmarc';
  /** pass, fail, softfail, neutral, none, temperror, permerror, policy, ... */
  result: string;
  /** header.d / header.i for DKIM, header.from for DMARC, smtp.mailfrom for SPF. */
  domain: string;
}

export interface AuthSummary {
  /** The server that wrote the Authentication-Results header (mx.google.com for Gmail). */
  authServ: string;
  spf: AuthResult | null;
  dkim: AuthResult[];
  dmarc: AuthResult | null;
  /** d= of every DKIM-Signature header, whether or not the receiver recorded a result. */
  signedBy: string[];
}

/** A link found in the email body that may be the download. */
export interface FoundLink {
  url: string;
  /** Anchor text, or the surrounding words in a plain-text body. */
  text: string;
  /** Higher is more likely the download link. */
  score: number;
}

export type DeliveryAppId = 'shopify' | 'sky-pilot' | 'filemonk' | 'big' | 'sendowl' | 'unknown';

export interface DeliveryAppGuess {
  id: DeliveryAppId;
  name: string;
  /** What gave it away, in plain words; empty when unknown. */
  because: string;
}

/** What the browser learns from the raw email alone. */
export interface EmailAnalysis {
  from: { name: string; address: string };
  subject: string;
  /** ISO time from the Date header, or '' when missing or unreadable. */
  sentAt: string;
  /** ISO time of the receiving server's last Received header, or ''. */
  receivedAt: string;
  /** Seconds between the first and the last Received hop; null when fewer than two hops have a time. */
  transitSeconds: number | null;
  auth: AuthSummary | null;
  links: FoundLink[];
  app: DeliveryAppGuess;
  /** Placement read from an X-Gmail-Labels header (Google Takeout), if present. */
  labelPlacement: Placement | null;
  listUnsubscribe: boolean;
}

/** The file (or page) a download link led to. */
export interface LinkResult {
  url: string;
  finalUrl: string;
  /** HTTP status of the last hop; 0 when no answer. */
  status: number;
  redirects: number;
  contentType: string;
  fileName: string;
  /** Bytes read (stops at the size cap). */
  size: number;
  /** True when the file was larger than the cap and only its start was hashed. */
  truncated: boolean;
  /** Hex SHA-256 of the bytes read; '' when nothing was read. */
  sha256: string;
  /** True when the answer was a web page rather than a file. */
  page: boolean;
  /** For a page: its title and whether it says the link expired or ran out. */
  pageTitle: string;
  pageSaysExpired: boolean;
  /** A plain-words error when the test could not finish. */
  error: string;
}

/** The right file, as a good link test saw it. */
export interface Baseline {
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  host: string;
  setAt: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** What to do about it; empty for an ok or info finding. */
  fix: string;
}

/** The saved report of one check (no raw email, no full download URL). */
export interface CheckReport {
  analysis: Omit<EmailAnalysis, 'links'> & { links: Array<{ host: string; text: string }> };
  placement: Placement;
  /** Set when the email came from the seed inbox check (milestone 3): where Gmail put it. */
  seed?: SeedOrigin;
  link: (Omit<LinkResult, 'url' | 'finalUrl'> & { host: string; finalHost: string }) | null;
  findings: Finding[];
}
