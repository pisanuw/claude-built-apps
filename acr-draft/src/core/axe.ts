import type { RuleOutcome, RuleResult, Scan } from './project';
import { tagToCriterion } from './wcag';

/** The axe-core version the app bundles and the console snippet loads. */
export const AXE_VERSION = '4.11.0';

/** WCAG 2.1 A and AA rule tags passed to axe.run. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface AxeNode {
  target?: unknown;
}
interface AxeRule {
  id?: unknown;
  help?: unknown;
  helpUrl?: unknown;
  impact?: unknown;
  tags?: unknown;
  nodes?: unknown;
}
interface AxeResults {
  url?: unknown;
  timestamp?: unknown;
  testEngine?: { version?: unknown };
  violations?: unknown;
  passes?: unknown;
  incomplete?: unknown;
}

function isResults(x: unknown): x is AxeResults {
  return !!x && typeof x === 'object' && Array.isArray((x as AxeResults).violations);
}

function targetText(t: unknown): string {
  // axe targets are arrays of selectors (several entries when crossing iframes or shadow roots).
  if (Array.isArray(t)) return t.map((p) => (Array.isArray(p) ? p.join(' >>> ') : String(p))).join(' > ');
  return String(t);
}

function toRules(list: unknown, outcome: RuleOutcome): RuleResult[] {
  if (!Array.isArray(list)) return [];
  const out: RuleResult[] = [];
  for (const raw of list as AxeRule[]) {
    if (!raw || typeof raw.id !== 'string') continue;
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [];
    const criteria = [...new Set(tags.map(tagToCriterion).filter((x): x is string => x !== null))];
    if (criteria.length === 0) continue; // best-practice or AAA/2.2 rules do not belong in a 2.1 AA report
    const nodes = Array.isArray(raw.nodes) ? (raw.nodes as AxeNode[]) : [];
    out.push({
      id: raw.id,
      help: typeof raw.help === 'string' ? raw.help : raw.id,
      helpUrl: typeof raw.helpUrl === 'string' ? raw.helpUrl : '',
      impact: typeof raw.impact === 'string' ? raw.impact : null,
      outcome,
      criteria,
      nodes: nodes.length,
      targets: nodes.slice(0, 5).map((n) => targetText(n?.target)),
    });
  }
  return out;
}

/** Convert one axe-core results object into a Scan. */
export function scanFromAxe(results: unknown, source: Scan['source'] = 'axe-json'): Scan {
  if (!isResults(results)) throw new Error('These are not axe-core results (no "violations" list found).');
  const version = results.testEngine && typeof results.testEngine.version === 'string' ? results.testEngine.version : '';
  return {
    source,
    engine: version ? `axe-core ${version}` : 'axe-core',
    url: typeof results.url === 'string' ? results.url : '',
    timestamp: typeof results.timestamp === 'string' ? results.timestamp : '',
    rules: [
      ...toRules(results.violations, 'violation'),
      ...toRules(results.incomplete, 'incomplete'),
      ...toRules(results.passes, 'pass'),
    ],
  };
}

/**
 * Parse pasted or uploaded axe output. Accepts a single axe.run() results
 * object, or the array @axe-core/cli writes with --save (one object per URL).
 * Returns one Scan per page found.
 */
export function parseAxeText(text: string): Scan[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new Error('That is not valid JSON. Paste the whole output of the snippet or the file axe saved.');
  }
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) throw new Error('The file contains an empty list: axe found no pages to report.');
  return list.map((r, i) => {
    try {
      return scanFromAxe(r);
    } catch (e) {
      throw new Error(list.length > 1 ? `Item ${i + 1}: ${(e as Error).message}` : (e as Error).message);
    }
  });
}

export interface ScanCounts {
  violations: number;
  /** Elements affected across all violated rules. */
  elements: number;
  incomplete: number;
  passes: number;
}

export function countScan(scan: Scan): ScanCounts {
  let violations = 0;
  let elements = 0;
  let incomplete = 0;
  let passes = 0;
  for (const r of scan.rules) {
    if (r.outcome === 'violation') {
      violations += 1;
      elements += r.nodes;
    } else if (r.outcome === 'incomplete') incomplete += 1;
    else passes += 1;
  }
  return { violations, elements, incomplete, passes };
}

/**
 * Code to paste into the browser DevTools console on a signed-in screen. It
 * loads axe-core from a CDN (cdnjs, then jsDelivr), runs the WCAG 2.1 AA
 * rules, and copies the results to the clipboard.
 */
export function consoleSnippet(): string {
  const urls = [
    `https://cdnjs.cloudflare.com/ajax/libs/axe-core/${AXE_VERSION}/axe.min.js`,
    `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`,
  ];
  return `(async () => {
  const load = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  if (!window.axe) { try { await load(${JSON.stringify(urls[0])}); } catch { await load(${JSON.stringify(urls[1])}); } }
  const r = await axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } });
  const json = JSON.stringify(r);
  try { copy(json); console.log('ACR Draft: results copied (' + r.violations.length + ' rules failed). Paste them into the app.'); }
  catch { console.log(json); }
})();`;
}

/** Command for teams that prefer the terminal (public pages only). */
export function cliCommand(url: string): string {
  const safe = url && /^https?:\/\/[^\s'"]+$/.test(url) ? url : 'https://your-product.example/page';
  return `npx @axe-core/cli@${AXE_VERSION} ${safe} --tags ${AXE_TAGS.join(',')} --save axe-results.json`;
}
