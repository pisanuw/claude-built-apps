/**
 * The report: every outside tool found, which pages it runs on, what it
 * receives, what its maker says about a BAA, and how urgent it looks.
 *
 * Levels describe what the report found, never a legal conclusion:
 *  review: a tool that sees what visitors do or type runs on a health page,
 *          and its maker does not sign a BAA (or we could not confirm one);
 *  check:  something on a health page needs a quick confirmation
 *          (BAA only on some plans, a file server, an unknown company);
 *  ok:     a tool whose maker signs a BAA, built for this kind of data;
 *  fyi:    seen only on pages that are not health pages.
 */
import type { Capture, Source } from './capture';
import type { PageKind } from './pages';
import { guessPageKind, isHealthKind } from './pages';
import type { BaaStatus, Kind, Vendor } from './vendors';
import { KINDS, TABLE_REVIEWED, vendorForUrl } from './vendors';

export type Practice = 'hipaa' | 'wellness' | 'unsure';
export type StateLaw = 'WA' | 'NV' | 'CT';

export interface Profile {
  practice: Practice;
  states: StateLaw[];
}

export type Level = 'review' | 'check' | 'ok' | 'fyi';
export const LEVEL_ORDER: Level[] = ['review', 'check', 'fyi', 'ok'];

export interface ToolPage {
  url: string;
  kind: PageKind;
  health: boolean;
  sentPageAddress: boolean;
}

export interface ToolFinding {
  /** Vendor id, or "host:<domain>" for a company the table does not know. */
  key: string;
  name: string;
  company: string;
  kind: Kind | null;
  baa: BaaStatus | null;
  level: Level;
  hosts: string[];
  pages: ToolPage[];
  onHealthPages: boolean;
  /** Plain sentences explaining the level. */
  why: string[];
  receives: string;
  baaNote: string;
  options: string;
}

export interface PageRow {
  url: string;
  title: string;
  kind: PageKind;
  health: boolean;
  source: Source;
  tools: string[];
}

export interface Report {
  site: string;
  generatedAt: string;
  tableReviewed: string;
  profile: Profile;
  pages: PageRow[];
  tools: ToolFinding[];
  counts: Record<Level, number>;
  healthPageCount: number;
  warnings: string[];
}

export const BASIC_RECEIVES = 'Every outside request gives the company the visitor’s IP address, browser and device details, and the website they are on.';

const STATE_NAMES: Record<StateLaw, string> = { WA: 'Washington', NV: 'Nevada', CT: 'Connecticut' };

/** Group key for a host the table does not know: its last two labels (three for co.uk-style names). */
export function domainKey(host: string): string {
  const parts = host.split('.');
  const n = parts.length >= 3 && /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

function levelFor(vendor: Vendor | null, onHealth: boolean): Level {
  if (vendor?.baa === 'offers') return 'ok';
  if (!onHealth) return 'fyi';
  if (!vendor) return 'check';
  if (vendor.baa === 'some-plans') return 'check';
  return KINDS[vendor.kind].weight === 'high' ? 'review' : 'check';
}

function explain(f: Omit<ToolFinding, 'why'>, vendor: Vendor | null, profile: Profile): string[] {
  const why: string[] = [];
  const healthPages = f.pages.filter((p) => p.health);
  const sent = f.pages.filter((p) => p.sentPageAddress);
  if (healthPages.length) why.push(`Runs on ${healthPages.length} health page${healthPages.length === 1 ? '' : 's'}.`);
  else why.push('Seen only on pages that are not booking, intake or service pages.');
  if (sent.length) why.push(`It received the full page address (for example ${pathLabel(sent[0].url)}), so the company can tell which service the visitor was reading about.`);
  if (!vendor) {
    why.push('This company is not in our vendor table, so we cannot say what it does. Ask your web person what it is.');
    return why;
  }
  if (f.level === 'ok') why.push('Its maker signs a BAA. Keep your signed copy with your privacy records.');
  if (f.level === 'review') {
    const baa = profile.practice === 'wellness' ? '' : `, and ${vendor.baa === 'no' ? 'this vendor does not sign a BAA' : 'we could not confirm that this vendor signs a BAA'}`;
    why.push(`Tools like this see what visitors do or type on the page and send it to ${vendor.company}${baa}.`);
  }
  if (f.level === 'check' && vendor.baa === 'some-plans') why.push('Its maker signs a BAA only on some plans: confirm yours is one of them and that the BAA is signed.');
  if (f.level === 'check' && vendor.baa !== 'some-plans') why.push('It mostly serves a file, so it sees the visit but little else. It is still a company receiving the visit to a health page.');
  if (f.onHealthPages && profile.states.length && KINDS[vendor.kind].weight === 'high' && vendor.baa !== 'offers') {
    const names = profile.states.map((s) => STATE_NAMES[s]).join(', ');
    why.push(`You serve people in ${names}, where consumer health data laws can require a visitor’s separate consent before information that they sought care is shared with a company like this.`);
  }
  return why;
}

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Build the report. `overrides` holds the owner's own choice of kind for a
 * page (keyed by normalized page URL); every other page is guessed.
 */
export function analyze(capture: Capture, profile: Profile, overrides: Record<string, PageKind> = {}, now: Date = new Date()): Report {
  const pages: PageRow[] = capture.pages.map((p) => {
    const kind = overrides[p.url] ?? guessPageKind(p.url, p.title);
    return { url: p.url, title: p.title, kind, health: isHealthKind(kind), source: p.source, tools: [] };
  });
  const byUrl = new Map(pages.map((p) => [p.url, p]));

  interface Acc {
    vendor: Vendor | null;
    hosts: Set<string>;
    pages: Map<string, ToolPage>;
  }
  const acc = new Map<string, Acc>();
  for (const cp of capture.pages) {
    const row = byUrl.get(cp.url) as PageRow;
    for (const r of cp.requests) {
      const vendor = vendorForUrl(r.url);
      const key = vendor ? vendor.id : `host:${domainKey(r.host)}`;
      let a = acc.get(key);
      if (!a) {
        a = { vendor, hosts: new Set(), pages: new Map() };
        acc.set(key, a);
      }
      a.hosts.add(r.host);
      const tp = a.pages.get(row.url) ?? { url: row.url, kind: row.kind, health: row.health, sentPageAddress: false };
      tp.sentPageAddress ||= r.sentPageAddress;
      a.pages.set(row.url, tp);
      if (!row.tools.includes(key)) row.tools.push(key);
    }
  }

  const tools: ToolFinding[] = [];
  for (const [key, a] of acc) {
    const v = a.vendor;
    const tpages = [...a.pages.values()];
    const onHealth = tpages.some((p) => p.health);
    const base: Omit<ToolFinding, 'why'> = {
      key,
      name: v ? v.name : key.slice(5),
      company: v ? v.company : key.slice(5),
      kind: v ? v.kind : null,
      baa: v ? v.baa : null,
      level: levelFor(v, onHealth),
      hosts: [...a.hosts].sort(),
      pages: tpages,
      onHealthPages: onHealth,
      receives: v ? KINDS[v.kind].receives : 'Unknown: the company is not in our table.',
      baaNote: v ? v.baaNote : 'Unknown company. Find out who runs it and what it is for.',
      options: v ? KINDS[v.kind].options : 'Ask your web person which plugin or setting adds this. If nobody knows, it is worth removing.',
    };
    tools.push({ ...base, why: explain(base, v, profile) });
  }
  tools.sort((x, y) => LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level) || Number(y.onHealthPages) - Number(x.onHealthPages) || x.name.localeCompare(y.name));

  const counts: Record<Level, number> = { review: 0, check: 0, ok: 0, fyi: 0 };
  for (const t of tools) counts[t.level]++;
  const healthPageCount = pages.filter((p) => p.health).length;

  const warnings: string[] = [];
  if (healthPageCount === 0) warnings.push('None of these pages looks like a booking, intake or service page. Record those pages too, or mark a page’s kind below if our guess is wrong.');
  if (pages.some((p) => p.source === 'page-source') && !pages.some((p) => p.source === 'recording')) {
    warnings.push('This check read page source only. Tools that other scripts load afterwards (anything added through Google Tag Manager, for example) do not appear in page source, so a browser recording usually finds more.');
  }
  return { site: capture.site, generatedAt: now.toISOString(), tableReviewed: TABLE_REVIEWED, profile, pages, tools, counts, healthPageCount, warnings };
}

/** One line for the top of the report. */
export function verdict(r: Report): string {
  if (r.counts.review) return `${r.counts.review} tool${r.counts.review === 1 ? '' : 's'} on your health pages to review now.`;
  if (r.counts.check) return `Nothing urgent, but ${r.counts.check} thing${r.counts.check === 1 ? '' : 's'} on your health pages to confirm.`;
  if (r.healthPageCount === 0) return 'No health pages in this check yet.';
  return 'No outside tool on your health pages needs attention.';
}

export const LEVEL_LABEL: Record<Level, string> = {
  review: 'Review now',
  check: 'Confirm',
  ok: 'Signs a BAA',
  fyi: 'Not on health pages',
};

/** A short paragraph on what the levels mean for this kind of practice. */
export function context(profile: Profile): string {
  const hipaa = 'If you are covered by HIPAA, a company that receives health information on your behalf needs a signed Business Associate Agreement (BAA).';
  const wellness = 'If HIPAA does not cover you, consumer health data laws can (Washington’s My Health My Data Act covers wellness businesses too), and ad platforms’ own terms forbid sending them health information.';
  const tail = ' Start with the tools marked Review now.';
  if (profile.practice === 'hipaa') return hipaa + tail;
  if (profile.practice === 'wellness') return wellness + tail;
  return `${hipaa} ${wellness}${tail}`;
}
