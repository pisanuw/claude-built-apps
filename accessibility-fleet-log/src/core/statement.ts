import { buildLog, byCriterion, daysBetween, siteChecks, STATEMENT_DUE_DAYS, type Issue } from './log';
import type { Fleet, Site } from './model';
import { criterion } from './wcag';

/**
 * Draft accessibility statement for one site, built from its issue log. The
 * wording never claims more than the evidence shows: open issues make it
 * "partially conformant", and without a recent manual review a clean
 * automated check only says "no known problems, not yet confirmed".
 */

export type StatementStatus = 'partial' | 'unconfirmed' | 'believed';

export interface Section {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface StatementDoc {
  title: string;
  status: StatementStatus;
  sections: Section[];
}

const STATUS_LABEL: Record<StatementStatus, string> = {
  partial: 'Partially conformant',
  unconfirmed: 'Not yet confirmed',
  believed: 'Meets the standard as far as we know',
};

export function statusLabel(s: StatementStatus): string {
  return STATUS_LABEL[s];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function path(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function problemLines(open: Issue[], notes: Record<string, string>): string[] {
  return byCriterion(open)
    .filter((g) => g.id !== '')
    .map((g) => {
      const cr = criterion(g.id);
      const examples = [...new Set(g.issues.map((i) => path(i.pageUrl)))].slice(0, 3);
      const where = g.pages === 1 ? `on ${examples[0]}` : `on ${g.pages} pages, for example ${examples.join(', ')}`;
      const extra = [...new Set(g.issues.map((i) => notes[i.key]).filter((n): n is string => !!n))];
      const head = cr ? `${cr.plain} (WCAG ${g.id} ${cr.name}, ${where}.)` : `Problems with WCAG ${g.id} (${where}.)`;
      return extra.length > 0 ? `${head} ${extra.join(' ')}` : head;
    });
}

export function buildStatement(fleet: Fleet, site: Site, today: string): StatementDoc {
  const checks = siteChecks(fleet, site.id);
  const log = buildLog(fleet, site);
  const open = log.filter((i) => i.status === 'open' && i.scope === 'target');
  const extraOpen = log.filter((i) => i.status === 'open' && i.scope !== 'target').length;
  const last = checks.length > 0 ? checks[checks.length - 1] : null;
  const recentManual = site.manualReview !== '' && daysBetween(site.manualReview, today) <= STATEMENT_DUE_DAYS;
  const status: StatementStatus = open.length > 0 || !last ? 'partial' : recentManual ? 'believed' : 'unconfirmed';
  const owner = site.owner.trim() || site.client.trim() || '[organisation name]';
  const where = site.url.trim() || '[website address]';
  const level = `WCAG ${site.target} level AA`;
  const sections: Section[] = [];

  sections.push({
    heading: 'Our commitment',
    paragraphs: [`${owner} wants ${where} to be usable by as many people as possible, including people with disabilities. This statement applies to ${where}.`],
  });

  const std = [`We aim to meet the Web Content Accessibility Guidelines (${level}).`];
  if (site.jurisdiction !== 'us') {
    std.push(
      site.target === '2.1'
        ? 'This is the level the European standard EN 301 549 uses for websites, which the European Accessibility Act (in Germany, the Barrierefreiheitsstärkungsgesetz, BFSG) relies on.'
        : 'It includes everything in WCAG 2.1 level AA, the level the European standard EN 301 549 uses for websites, which the European Accessibility Act (in Germany, the BFSG) relies on.',
    );
  }
  if (site.jurisdiction !== 'eu') {
    std.push('In the United States there is no single legal web standard for private businesses under the Americans with Disabilities Act (ADA); WCAG level AA is the one most commonly used.');
  }
  sections.push({ heading: 'Standard we work to', paragraphs: std });

  const statusText: Record<StatementStatus, string> = {
    partial: last ? `This website is partially conformant with ${level}: some parts do not fully meet the standard yet. The known problems are listed below.` : `This website has not been checked yet, so we cannot say how well it meets ${level}.`,
    unconfirmed: `Our most recent automated check found no problems against ${level} on the pages checked. Automated tools only find some kinds of accessibility problems, and a full review by a person has not been done in the last year, so we have not confirmed that the site fully meets the standard.`,
    believed: `As far as we know, this website meets ${level}. It was last reviewed by a person on ${longDate(site.manualReview)}, and our most recent automated check found no problems on the pages checked.`,
  };
  sections.push({ heading: `Conformance status: ${STATUS_LABEL[status]}`, paragraphs: [statusText[status]] });

  if (open.length > 0) {
    sections.push({ heading: 'Known problems', paragraphs: ['These problems were found by our checks and are being worked on:'], bullets: problemLines(open, fleet.notes) });
  }
  if (site.knownLimits.trim()) {
    sections.push({ heading: 'Other content that may not be fully accessible', paragraphs: site.knownLimits.trim().split(/\n\s*\n/).map((p) => p.trim()) });
  }

  if (last) {
    const engines = [...new Set(checks.map((c) => c.engine))].join(', ');
    const pages = new Set(last.pages.map((p) => p.url)).size;
    const method = [
      `This is a self-assessment. We check the site with automated tools (${engines}). The most recent check was on ${longDate(last.date)} and covered ${plural(pages, 'page')}. Each problem is logged with the date it was found and the date it was fixed.`,
    ];
    method.push(site.manualReview ? `The last review by a person was on ${longDate(site.manualReview)}.` : 'The site has not yet had a full review by a person.');
    if (extraOpen > 0) method.push(`We also track ${plural(extraOpen, 'improvement')} that ${extraOpen === 1 ? 'goes' : 'go'} beyond ${level}.`);
    sections.push({ heading: 'How we checked', paragraphs: method });
  }

  const email = site.contactEmail.trim() || '[contact email]';
  const feedback = [`If you find a problem on this website, or need information in a different format, please email ${email}. Tell us the page address and what went wrong, and we will reply as soon as we can.`];
  if (site.jurisdiction !== 'us') {
    feedback.push(
      'If you are not satisfied with our reply, you can contact the authority that oversees accessibility in your country. In Germany this is the Marktüberwachungsstelle der Länder für die Barrierefreiheit von Produkten und Dienstleistungen (MLBF).',
    );
  }
  sections.push({ heading: 'Feedback and contact', paragraphs: feedback });

  sections.push({ heading: 'About this statement', paragraphs: [`This statement was prepared on ${longDate(today)}${last ? ` using the results of the check on ${longDate(last.date)}` : ''}. We review it at least once a year and after every major change to the site.`] });

  return { title: `Accessibility statement for ${site.name.trim() || where}`, status, sections };
}

/** Plain text (Markdown-style) used for version history and copy/paste. */
export function statementText(doc: StatementDoc): string {
  const out = [`# ${doc.title}`, ''];
  for (const s of doc.sections) {
    out.push(`## ${s.heading}`, '');
    for (const p of s.paragraphs) out.push(p, '');
    if (s.bullets && s.bullets.length > 0) {
      for (const b of s.bullets) out.push(`- ${b}`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** HTML to paste into the site's page editor (WordPress "Custom HTML" block). */
export function statementHtml(doc: StatementDoc): string {
  const out = [`<h1>${escapeHtml(doc.title)}</h1>`];
  for (const s of doc.sections) {
    out.push(`<h2>${escapeHtml(s.heading)}</h2>`);
    for (const p of s.paragraphs) out.push(`<p>${escapeHtml(p)}</p>`);
    if (s.bullets && s.bullets.length > 0) out.push(`<ul>\n${s.bullets.map((b) => `  <li>${escapeHtml(b)}</li>`).join('\n')}\n</ul>`);
  }
  return out.join('\n') + '\n';
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Line diff between two statement versions (longest common subsequence). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: 'removed', text: a[i++] });
    else out.push({ kind: 'added', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++] });
  while (j < m) out.push({ kind: 'added', text: b[j++] });
  return out;
}
