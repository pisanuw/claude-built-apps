/**
 * The analysis: which tracking cookies and requests happened when the visitor
 * had not agreed to them, grouped by vendor, each with its best attribution.
 */
import type { Capture, Request } from './har';
import { isFirstParty } from './har';
import type { Purpose, Vendor } from './catalog';
import { isNecessaryCookie, vendorForCookie, vendorForUrl } from './catalog';
import type { Attribution, PluginSighting } from './attribution';
import { attributeInline, attributeRequest, attributeUrl, pluginInventory } from './attribution';
import type { CmpInfo } from './cmp';
import { detectCmp } from './cmp';

/** What the owner says the recording shows. */
export type Mode = 'no-choice' | 'rejected';

/** When, relative to the banner click, something happened. */
export type Phase = 'before-choice' | 'after-reject';

export interface Evidence {
  type: 'cookie' | 'request';
  /** Cookie name, or the request URL without its query string. */
  name: string;
  /** Full URL of the first request that showed it. */
  firstUrl: string;
  /** Page (document) that was open at the time. */
  page: string;
  phase: Phase;
  count: number;
  /** For cookies: who set it. */
  setBy?: 'server' | 'script' | 'third-party';
  /** False for things worth knowing that are not a leak on their own (for example a Consent Mode ping sent with consent denied). */
  leak: boolean;
  note?: string;
}

export interface Finding {
  vendorId: string;
  vendor: string;
  purpose: Purpose;
  what: string;
  severity: 'leak' | 'notice';
  evidence: Evidence[];
  attributions: Attribution[];
}

export interface ScanReport {
  app: 'consent-leak-watch';
  version: 1;
  mode: Mode;
  site: string;
  pageTitle: string;
  pages: string[];
  /** Time of the first request in the recording. */
  recordedAt: string;
  analyzedAt: string;
  requestCount: number;
  cmp: CmpInfo;
  findings: Finding[];
  /** First-party cookies we could not classify; listed so nothing is silently dropped. */
  unclassifiedCookies: string[];
  /** Cookies that were already there when the recording started (not counted). */
  preexistingCookies: string[];
  plugins: PluginSighting[];
  warnings: string[];
}

function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

/** Read Google's Consent Mode "gcs" parameter: G1<ad_storage><analytics_storage>. */
export function consentModeState(url: string): { ad: boolean; analytics: boolean } | null {
  let gcs: string | null = null;
  try {
    gcs = new URL(url).searchParams.get('gcs');
  } catch {
    return null;
  }
  const m = gcs ? /^G1([01-])([01-])/.exec(gcs) : null;
  if (!m) return null;
  return { ad: m[1] === '1', analytics: m[2] === '1' };
}

function requestEvidence(r: Request, vendor: Vendor): Pick<Evidence, 'leak' | 'note'> {
  if (vendor.purpose === 'notice') return { leak: false };
  const cm = consentModeState(r.url);
  if (cm && (vendor.id === 'google-analytics' || vendor.id === 'google-ads')) {
    const granted = vendor.id === 'google-analytics' ? cm.analytics : cm.ad;
    if (!granted) {
      return {
        leak: false,
        note: 'Sent by Google Consent Mode with consent denied: no cookies, but Google still receives a cookieless hit. Whether that is acceptable is a question for your legal adviser.',
      };
    }
    return { leak: true, note: 'Consent Mode says consent was granted, but the visitor had not agreed.' };
  }
  return { leak: true };
}

const MODE_LABEL: Record<Mode, string> = { 'no-choice': 'before choosing', rejected: 'after Reject all' };

export function modeLabel(mode: Mode): string {
  return MODE_LABEL[mode];
}

/** Analyze one recording. `now` is injectable for tests. */
export function analyze(capture: Capture, mode: Mode, now: Date = new Date()): ScanReport {
  const cmp = detectCmp(capture);
  const warnings: string[] = [];
  const site = capture.siteHost;

  if (capture.looksSanitized) {
    warnings.push(
      'This recording has no cookies in it at all. Newer Chrome versions remove cookies when saving a HAR unless you turn on “Allow to generate HAR with sensitive data” in DevTools settings and use “Export HAR (with sensitive data)”. Tracker requests below are still checked, but cookie leaks cannot be.',
    );
  }
  if (!cmp.name) {
    warnings.push('No consent banner was recognised (Complianz, CookieYes, Cookiebot, OneTrust, Borlabs and Real Cookie Banner are). If your banner is another one, findings are still valid, but the click moment cannot be found.');
  }
  if (mode === 'rejected' && cmp.name) {
    if (cmp.choice === 'accepted' || cmp.choice === 'custom') {
      warnings.push(`${cmp.name}’s cookie says the visitor ${cmp.choice === 'accepted' ? 'accepted' : 'made a custom choice'}, not Reject all. Only what happened before that click is counted.`);
    } else if (cmp.choiceIndex === -1) {
      warnings.push(`No Reject all choice was found in ${cmp.name}’s cookie. Make sure you clicked Reject all and then opened at least one more page while recording.`);
    }
  }
  if (mode === 'no-choice' && cmp.choiceIndex !== -1) {
    warnings.push('A banner choice was made during this recording. Only what happened before the click is counted as “before choosing”.');
  }

  const decidedReject = cmp.choice === 'rejected' && cmp.choiceIndex !== -1;
  const phaseOf = (r: Request): Phase | null => {
    if (cmp.choiceIndex === -1) return mode === 'no-choice' ? 'before-choice' : 'after-reject';
    if (r.index < cmp.choiceIndex) return 'before-choice';
    return decidedReject && mode === 'rejected' ? 'after-reject' : null;
  };

  // Cookies already present on the very first request were set by an earlier visit.
  const firstDoc = capture.requests.find((r) => isFirstParty(r.host, site));
  const preexisting = new Set((firstDoc?.sentCookies ?? []).map((c) => c.name));
  if (preexisting.size) {
    warnings.push(
      `The first request already sent ${preexisting.size} cookie(s) (${[...preexisting].slice(0, 6).join(', ')}${preexisting.size > 6 ? ', …' : ''}), so this was not a fresh visit. Record in a new private window. Those cookies are not counted.`,
    );
  }

  const serverSet = new Map<string, Request>();
  for (const r of capture.requests) for (const c of r.setCookies) if (!serverSet.has(c.name)) serverSet.set(c.name, r);

  const findings = new Map<string, Finding>();
  const evidenceKey = new Map<string, Evidence>();
  const unclassified = new Set<string>();
  let page = capture.pageUrl;

  const add = (vendor: Vendor, ev: Omit<Evidence, 'count'>) => {
    let f = findings.get(vendor.id);
    if (!f) {
      f = { vendorId: vendor.id, vendor: vendor.name, purpose: vendor.purpose, what: vendor.what, severity: 'notice', evidence: [], attributions: [] };
      findings.set(vendor.id, f);
    }
    const key = `${vendor.id}|${ev.type}|${ev.name}|${ev.phase}|${ev.leak}`;
    const existing = evidenceKey.get(key);
    if (existing) {
      existing.count++;
      return;
    }
    const e: Evidence = { ...ev, count: 1 };
    evidenceKey.set(key, e);
    f.evidence.push(e);
    if (e.leak) f.severity = 'leak';
  };

  for (const r of capture.requests) {
    if (r.resourceType === 'document' && isFirstParty(r.host, site)) page = r.url;
    const phase = phaseOf(r);
    if (!phase) continue;

    const v = vendorForUrl(r.url);
    if (v) add(v, { type: 'request', name: stripQuery(r.url), firstUrl: r.url, page, phase, ...requestEvidence(r, v) });

    const names = new Set([...r.sentCookies, ...r.setCookies].map((c) => c.name));
    for (const name of names) {
      if (preexisting.has(name)) continue;
      const cv = vendorForCookie(name);
      if (!cv) {
        if (!isNecessaryCookie(name) && isFirstParty(r.host, site)) unclassified.add(name);
        continue;
      }
      const setter = serverSet.get(name);
      const setBy: Evidence['setBy'] = !setter ? 'script' : isFirstParty(setter.host, site) ? 'server' : 'third-party';
      add(cv, { type: 'cookie', name, firstUrl: (setter && setter.index <= r.index ? setter : r).url, page, phase, setBy, leak: true });
    }
  }

  for (const f of findings.values()) f.attributions = attributeFinding(f, capture, serverSet);

  const order: Record<string, number> = { leak: 0, notice: 1 };
  const purposeOrder: Record<Purpose, number> = { marketing: 0, analytics: 1, embed: 2, notice: 3, necessary: 4 };
  const sorted = [...findings.values()].sort(
    (a, b) => order[a.severity] - order[b.severity] || purposeOrder[a.purpose] - purposeOrder[b.purpose] || a.vendor.localeCompare(b.vendor),
  );

  return {
    app: 'consent-leak-watch',
    version: 1,
    mode,
    site,
    pageTitle: capture.pageTitle,
    pages: capture.pages,
    recordedAt: capture.requests[0]?.started ?? '',
    analyzedAt: now.toISOString(),
    requestCount: capture.requests.length,
    cmp,
    findings: sorted,
    unclassifiedCookies: [...unclassified].sort(),
    preexistingCookies: [...preexisting].sort(),
    plugins: pluginInventory(capture),
    warnings,
  };
}

function attributeFinding(f: Finding, capture: Capture, serverSet: Map<string, Request>): Attribution[] {
  const out: Attribution[] = [];
  const push = (a: Attribution) => {
    const key = `${a.kind}|${a.slug ?? a.label ?? ''}`;
    if (!out.some((o) => `${o.kind}|${o.slug ?? o.label ?? ''}` === key)) out.push(a);
  };
  // 1. Requests that belong to this vendor (its script loads and beacons), in any phase.
  for (const r of capture.requests) {
    if (vendorForUrl(r.url)?.id !== f.vendorId) continue;
    const a = attributeRequest(r, capture);
    if (a.kind !== 'unknown') push(a);
  }
  // 2. Cookies set by the shop's own server have no script behind them.
  for (const e of f.evidence) {
    if (e.type !== 'cookie' || e.setBy !== 'server') continue;
    const setter = serverSet.get(e.name);
    const byUrl = setter ? attributeUrl(setter.url) : null;
    push(byUrl && byUrl.kind !== 'optimizer' ? byUrl : { kind: 'server', evidence: `Set-Cookie: ${e.name} from ${setter?.url ?? 'the shop'}` });
  }
  // 3. The snippet in the page HTML and the id WordPress gave it.
  if (!out.some((a) => a.kind === 'plugin' || a.kind === 'theme')) {
    const inline = attributeInline(f.vendorId, capture);
    if (inline) push(inline);
  }
  if (out.length === 0) {
    const firstReq = capture.requests.find((r) => vendorForUrl(r.url)?.id === f.vendorId);
    push({ kind: 'unknown', evidence: firstReq?.initiatorUrls[0] ?? 'no script path recorded' });
  }
  return out;
}

export function leakCount(report: ScanReport): number {
  return report.findings.filter((f) => f.severity === 'leak').length;
}
