import { parse, type HTMLElement } from 'node-html-parser';

/**
 * A page as the checker reads it: the HTML the store's server sends, with no
 * scripts run. Google's reviewers see the rendered page, but almost every
 * store builder puts policies, contact details and product data in the HTML
 * itself, which is what this reads.
 */
export interface Doc {
  root: HTMLElement;
  /** Visible text, one block element per line, whitespace collapsed inside lines. */
  lines: string[];
  /** Footer text only (empty when the page has no footer element). */
  footerLines: string[];
  title: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', ndash: '–', mdash: '—', euro: '€', pound: '£', yen: '¥', copy: '©', reg: '®', trade: '™', middot: '·',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function textLines(el: HTMLElement): string[] {
  return decodeEntities(el.structuredText)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function readPage(html: string): Doc {
  const root = parse(html, { comment: false });
  const textRoot = parse(html, { comment: false });
  for (const el of textRoot.querySelectorAll('head, script, style, noscript, template, svg, select')) el.remove();
  const footer = textRoot.querySelector('footer');
  const titleEl = root.querySelector('title');
  return {
    root,
    lines: textLines(textRoot),
    footerLines: footer ? textLines(footer) : [],
    title: titleEl ? decodeEntities(titleEl.text).replace(/\s+/g, ' ').trim() : '',
  };
}

/** Split lines into sentences, so one claim's evidence is one sentence, not a whole policy. */
export function sentences(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Shorten evidence text for the report. */
export function clip(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Every JSON-LD block on the page, flattened (@graph and arrays opened up). Bad JSON is skipped. */
export function jsonLd(root: HTMLElement): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (Array.isArray(o['@graph'])) visit(o['@graph'], depth + 1);
    if (o['@type'] !== undefined) out.push(o);
  };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.rawText.trim()), 0);
    } catch {
      // A broken block is invisible to Google too; the check for it lives elsewhere.
    }
  }
  return out;
}

/** True when the JSON-LD node's @type is (or includes) one of the given types. */
export function hasType(node: Record<string, unknown>, ...types: string[]): boolean {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === 'string' && types.includes(x.replace(/^https?:\/\/schema\.org\//, '')));
}

export function meta(root: HTMLElement, key: string): string | undefined {
  const el = root.querySelector(`meta[property="${key}"]`) ?? root.querySelector(`meta[name="${key}"]`);
  const v = el?.getAttribute('content');
  return v ? decodeEntities(v).trim() : undefined;
}
