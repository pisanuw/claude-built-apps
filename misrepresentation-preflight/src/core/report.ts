import { KIND_LABEL } from './classify';
import type { Comparison } from './history';
import type { PageFacts, ScanResult, Severity } from './types';
import { shortUrl } from './urls';
import { formatRange } from './windows';

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'Fix first', medium: 'Fix soon', low: 'Worth a look' };

export const DISCLAIMER =
  'This report lists contradictions found on the public pages that were read. Google does not say why it suspends a store, and fixing these does not guarantee reinstatement; some suspensions have causes no website check can see.';

/** One row of the "what each page says" grid. */
export interface FactRow {
  url: string;
  kind: string;
  contact: string;
  shipping: string;
  returns: string;
  price: string;
}

export function factRows(pages: PageFacts[]): FactRow[] {
  return pages
    .filter((p) => !p.blocked)
    .map((p) => {
      const contact = [...p.emails, ...p.phones.map((x) => x.text), ...p.addresses.filter((a) => a.postcode).map((a) => a.postcode as string)];
      const shipping = [...new Set(p.shipping.map((s) => `${s.speed === 'standard' ? '' : `${s.speed} `}${s.stage === 'processing' ? 'ships in' : 'arrives in'} ${formatRange(s)}`))];
      const free = p.freeShipping.map((f) => `free over ${f.currency ? `${f.currency} ` : ''}${f.threshold}`);
      const returns = [...new Set(p.returns.map((r) => (r.noReturns ? 'no returns' : `${r.days} days`)))];
      const offer = p.offers.find((o) => o.price !== undefined);
      const stock = p.offers.find((o) => o.availability)?.availability;
      return {
        url: p.url,
        kind: KIND_LABEL[p.kind],
        contact: contact.join(', '),
        shipping: [...shipping, ...free].join('; '),
        returns: returns.join(', '),
        price: [offer?.price !== undefined ? `${offer.price.toFixed(2)}${offer.currency ? ` ${offer.currency}` : ''}` : '', stock ?? ''].filter(Boolean).join(', '),
      };
    });
}

function when(iso: string): string {
  return `${iso.replace('T', ' ').slice(0, 16)} UTC`;
}

/** The whole check as a Markdown document the owner can keep or send to a helper. */
export function markdownReport(r: ScanResult, diff?: Comparison): string {
  const lines: string[] = [];
  const count = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
  lines.push(`# Misrepresentation Preflight: ${shortUrl(r.site)}`, '');
  const failed = r.errors.filter((e) => !e.guessed);
  lines.push(`Checked ${when(r.checkedAt)}. ${r.pages.length} pages read${failed.length ? `, ${failed.length} could not be opened` : ''}.`);
  if (r.feed) lines.push(`Product feed: ${r.feed.items} products (${r.feed.format.toUpperCase()}).`);
  lines.push('', `**${r.findings.length} things to look at:** ${count('high')} fix first, ${count('medium')} fix soon, ${count('low')} worth a look.`, '');
  if (diff) {
    lines.push(`## Since the check on ${when(diff.previous.checkedAt)}`, '');
    lines.push(`- Fixed: ${diff.fixed.length ? diff.fixed.map((f) => f.title).join('; ') : 'none'}`);
    lines.push(`- New: ${diff.added.length ? diff.added.map((f) => f.title).join('; ') : 'none'}`);
    lines.push(`- Still open: ${diff.still.length}`, '');
  }
  for (const sev of ['high', 'medium', 'low'] as Severity[]) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    lines.push(`## ${SEVERITY_LABEL[sev]}`, '');
    for (const f of list) {
      lines.push(`### ${f.title}`, '', f.detail, '', `**What to do:** ${f.fix}`, '');
      for (const e of f.evidence) {
        const said = e.kind === 'note' ? e.text : `“${e.text}”`;
        lines.push(e.url ? `- ${/^https?:/.test(e.url) ? shortUrl(e.url) : e.url}: ${said}` : `- ${e.text}`);
      }
      if (f.evidence.length) lines.push('');
    }
  }
  if (!r.findings.length) lines.push('No contradictions were found on the pages read.', '');
  lines.push('## Pages read', '');
  for (const p of r.pages) lines.push(`- ${KIND_LABEL[p.kind]}: ${p.url}${p.blocked ? ' (blocked)' : ''}`);
  for (const e of failed) lines.push(`- Could not open: ${e.url} (${e.error})`);
  if (r.skippedByRobots.length) {
    lines.push('', `Skipped because the store’s robots.txt asks crawlers not to read them: ${r.skippedByRobots.map(shortUrl).join(', ')}.`);
  }
  if (r.readDespiteRobots.length) {
    lines.push('', `Read although robots.txt asks search engines to skip them (you confirmed the store is yours, and these are the pages Google’s reviewers read): ${r.readDespiteRobots.map(shortUrl).join(', ')}.`);
  }
  if (r.feed?.warnings.length) lines.push('', `Feed notes: ${r.feed.warnings.join(' ')}`);
  lines.push('', '---', '', DISCLAIMER, '');
  return lines.join('\n');
}
