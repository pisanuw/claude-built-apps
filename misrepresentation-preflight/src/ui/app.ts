import { DEMO_SETTINGS, DEMO_SITE, demoFeed, demoFetcher } from '../core/demo';
import { parseFeed } from '../core/feed';
import {
  addEntry, compare, loadLog, logCsv, previousFor, removeEntry, saveLog, setNote, toEntry,
  type Comparison, type KeyValue, type LogEntry,
} from '../core/history';
import { DISCLAIMER, factRows, markdownReport, SEVERITY_LABEL } from '../core/report';
import { scanStore, type Fetcher } from '../core/scan';
import type { DayRange, Feed, Finding, MerchantSettings, ScanResult, Severity } from '../core/types';
import { InputError, normalizeSiteUrl, shortUrl } from '../core/urls';
import { download, h } from './dom';
import { remoteFetcher } from './remote';

export interface Deps {
  fetchImpl?: typeof fetch;
  storage?: KeyValue | null;
  now?: () => Date;
  readFile?: (f: File) => Promise<string>;
  /** Pause between sample-store pages so the progress is visible. */
  demoDelayMs?: number;
  /** Pause between real-store pages, to be gentle on the store. */
  siteDelayMs?: number;
  print?: () => void;
}

export interface App {
  runDemo(fixed?: boolean): Promise<ScanResult | null>;
  runSite(): Promise<ScanResult | null>;
  readonly log: LogEntry[];
}

function safeStorage(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** "3-5" or "3" -> a day range; empty -> undefined. */
export function parseDays(raw: string, label: string): DayRange | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const m = /^(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})$|^(\d{1,3})$/.exec(t);
  if (!m) throw new InputError(`${label}: enter a number of days, such as 3 or 3-5.`);
  const min = Number(m[1] ?? m[3]);
  const max = Number(m[2] ?? m[3]);
  if (max < min) throw new InputError(`${label}: the second number should be the larger one.`);
  return { min, max, business: true };
}

type SettingField = { key: string; label: string; hint?: string; placeholder?: string; inputmode?: string };

const SETTING_FIELDS: SettingField[] = [
  { key: 'businessName', label: 'Business name', placeholder: 'Fernhill Candle Co.' },
  { key: 'phone', label: 'Phone number', placeholder: '(828) 555-0147' },
  { key: 'email', label: 'Email address', placeholder: 'hello@mystore.com' },
  { key: 'postcode', label: 'ZIP or postcode of your business address', placeholder: '28801' },
  { key: 'returnDays', label: 'Return window (days)', placeholder: '30', inputmode: 'numeric' },
  { key: 'handlingDays', label: 'Handling time (business days)', placeholder: '1-2', hint: 'Shipping settings in Merchant Center: time before an order ships.' },
  { key: 'transitDays', label: 'Transit time (business days)', placeholder: '3-5', hint: 'Time in the carrier’s hands.' },
];

const AREA_LABEL: Record<Finding['area'], string> = {
  contact: 'Contact details',
  shipping: 'Shipping',
  returns: 'Returns',
  price: 'Prices',
  stock: 'Stock',
  data: 'Product data',
  wording: 'Wording',
  pages: 'Pages',
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export function mount(root: HTMLElement, deps: Deps = {}): App {
  const storage = deps.storage === undefined ? safeStorage() : deps.storage;
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? (() => new Date());
  const readFile = deps.readFile ?? ((f: File) => f.text());
  const print = deps.print ?? (() => window.print());
  let log = loadLog(storage);
  let busy = false;
  // The sample shop does not exist, so its page addresses are shown as text, not links.
  let linkPages = true;

  // ---------- form ----------
  const siteInput = h('input', { id: 'f-site', type: 'text', inputmode: 'url', autocomplete: 'url', placeholder: 'mystore.com', 'aria-describedby': 'f-site-hint', spellcheck: 'false' });
  const feedInput = h('input', { id: 'f-feed', type: 'file', accept: '.txt,.tsv,.csv,.xml,text/plain,text/csv,text/tab-separated-values,application/xml,text/xml', 'aria-describedby': 'f-feed-hint' });
  const consent = h('input', { id: 'f-consent', type: 'checkbox' });
  const settingInputs = new Map<string, HTMLInputElement>();
  const settingRows = SETTING_FIELDS.map((f) => {
    const input = h('input', { id: `f-${f.key}`, type: 'text', placeholder: f.placeholder ?? '', ...(f.inputmode ? { inputmode: f.inputmode } : {}), ...(f.hint ? { 'aria-describedby': `f-${f.key}-hint` } : {}) });
    settingInputs.set(f.key, input);
    return h('div', { class: 'field' }, h('label', { for: `f-${f.key}` }, f.label), input, f.hint ? h('p', { class: 'hint', id: `f-${f.key}-hint` }, f.hint) : null);
  });
  const formError = h('p', { class: 'form-error', role: 'alert', id: 'form-error' });
  const checkButton = h('button', { type: 'submit', class: 'primary', id: 'check' }, 'Check my store');
  const form = h(
    'form',
    { class: 'panel', id: 'site-form', novalidate: true },
    h('h2', {}, 'Check your store'),
    h('div', { class: 'field' }, h('label', { for: 'f-site' }, 'Your store’s web address'), siteInput, h('p', { class: 'hint', id: 'f-site-hint' }, 'The home page of your shop. Shopify, WooCommerce, Wix, Squarespace and BigCommerce stores all work.')),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'f-feed' }, 'Your product feed (optional)'),
      feedInput,
      h('p', { class: 'hint', id: 'f-feed-hint' }, 'The file Google gets your products from: the TSV, CSV or XML file from your feed app, or Merchant Center > Products > All products > Download. It is read in your browser and never uploaded.'),
    ),
    h(
      'details',
      { class: 'settings' },
      h('summary', {}, 'What you told Merchant Center (optional)'),
      h('p', { class: 'hint' }, 'Copy these from Merchant Center (Business info, Shipping and returns). The check compares them with your store. They stay in this browser.'),
      h('div', { class: 'grid' }, ...settingRows),
    ),
    h('label', { class: 'consent', for: 'f-consent' }, consent, h('span', {}, 'This is my store, or I have the owner’s permission to check it.')),
    formError,
    h('div', { class: 'actions' }, checkButton),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void runSite();
  });

  const demoButton = h('button', { type: 'button', class: 'secondary', id: 'demo' }, 'Try the sample store');
  const demoAgain = h('button', { type: 'button', class: 'secondary', id: 'demo-fixed', hidden: true }, 'Check the sample store again, after fixes');
  demoButton.addEventListener('click', () => void runDemo(false));
  demoAgain.addEventListener('click', () => void runDemo(true));
  const demoPanel = h(
    'section',
    { class: 'panel demo', 'aria-labelledby': 'demo-title' },
    h('h2', { id: 'demo-title' }, 'See it on a sample shop first'),
    h('p', {}, 'Fernhill Candle Co. is a made-up candle shop with the kind of small contradictions real stores pick up over time: an old brand name in the theme, a FAQ that was never updated, a product feed with a deleted product. Run the check, then run it again after the owner’s fixes to see the re-check log at work.'),
    h('div', { class: 'actions' }, demoButton, demoAgain),
  );

  // ---------- progress and results ----------
  const progressText = h('p', { id: 'progress-text' });
  const progressBar = h('progress', { id: 'progress-bar', max: '1', value: '0', 'aria-label': 'Pages read' });
  const progress = h('div', { class: 'progress', hidden: true, 'aria-live': 'polite', id: 'progress' }, progressText, progressBar);
  const results = h('section', { class: 'results', id: 'results', 'aria-labelledby': 'results-title', hidden: true });
  const logBox = h('section', { class: 'panel log', id: 'log', 'aria-labelledby': 'log-title' });

  root.append(
    h(
      'header',
      { class: 'intro' },
      h('h1', {}, 'Misrepresentation Preflight'),
      h('p', { class: 'lede' }, 'Google suspended your Shopping account for “Misrepresentation” and won’t say why? Before you spend your next review request, see every place your store tells shoppers two different things.'),
      h(
        'ul',
        { class: 'checks-list' },
        h('li', {}, 'Business name, email, phone and address, page by page'),
        h('li', {}, 'Shipping times, free-shipping minimums and return windows across policies, FAQ, product pages and banners'),
        h('li', {}, 'Prices and stock: what shoppers see, the product data Google reads, and your feed'),
        h('li', {}, 'Wording reviewers distrust, such as “official retailer” or “clinically proven”'),
      ),
    ),
    h('main', {}, demoPanel, form, progress, results, logBox),
  );

  // ---------- helpers ----------
  const setBusy = (on: boolean) => {
    busy = on;
    for (const b of [checkButton, demoButton, demoAgain]) b.disabled = on;
  };

  function readSettings(): MerchantSettings | undefined {
    const get = (k: string) => settingInputs.get(k)?.value.trim() ?? '';
    const s: MerchantSettings = {};
    if (get('businessName')) s.businessName = get('businessName');
    if (get('phone')) s.phone = get('phone');
    if (get('email')) s.email = get('email');
    if (get('postcode')) s.postcode = get('postcode');
    if (get('returnDays')) {
      const n = Number(get('returnDays'));
      if (!Number.isInteger(n) || n <= 0 || n > 400) throw new InputError('Return window: enter a number of days, such as 30.');
      s.returnDays = n;
    }
    const hd = parseDays(get('handlingDays'), 'Handling time');
    if (hd) s.handlingDays = hd;
    const td = parseDays(get('transitDays'), 'Transit time');
    if (td) s.transitDays = td;
    return Object.keys(s).length ? s : undefined;
  }

  async function execute(site: string, fetcher: Fetcher, feed: Feed | undefined, settings: MerchantSettings | undefined, delayMs: number, lanes: number): Promise<ScanResult | null> {
    setBusy(true);
    progress.hidden = false;
    results.hidden = true;
    progressText.textContent = 'Reading the home page…';
    progressBar.value = 0;
    try {
      const result = await scanStore({
        site,
        fetcher,
        feed,
        settings,
        now,
        delayMs,
        concurrency: lanes,
        onProgress: (p) => {
          progressBar.max = Math.max(1, p.total);
          progressBar.value = p.done;
          progressText.textContent = `Read ${p.done} of ${p.total} pages. Now: ${shortUrl(p.url)}`;
        },
      });
      const entry = toEntry(result);
      const prev = previousFor(log, result.site, result.checkedAt);
      log = addEntry(log, entry);
      saveLog(storage, log);
      progress.hidden = true;
      showResults(result, prev ? compare(prev, entry) : undefined);
      renderLog();
      return result;
    } catch (e) {
      progress.hidden = true;
      formError.textContent = e instanceof Error ? e.message : 'The check failed.';
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runSite(): Promise<ScanResult | null> {
    if (busy) return null;
    formError.textContent = '';
    let site: string;
    let settings: MerchantSettings | undefined;
    let feed: Feed | undefined;
    try {
      site = normalizeSiteUrl(siteInput.value);
      if (!consent.checked) throw new InputError('Tick the box to confirm the store is yours (or that you have permission).');
      settings = readSettings();
      const file = feedInput.files?.[0];
      if (file) {
        if (file.size > 20 * 1024 * 1024) throw new InputError('The feed file is larger than 20 MB. Export a smaller file, or check without it.');
        feed = parseFeed(await readFile(file), site);
      }
    } catch (e) {
      formError.textContent = e instanceof Error ? e.message : 'Check the form.';
      return null;
    }
    linkPages = true;
    return execute(site, remoteFetcher(fetchImpl, site), feed, settings, deps.siteDelayMs ?? 400, 2);
  }

  async function runDemo(fixed = false): Promise<ScanResult | null> {
    if (busy) return null;
    formError.textContent = '';
    linkPages = false;
    const r = await execute(DEMO_SITE, demoFetcher(fixed), parseFeed(demoFeed(fixed), DEMO_SITE), DEMO_SETTINGS, deps.demoDelayMs ?? 60, 3);
    if (r) demoAgain.hidden = false;
    return r;
  }

  function evidenceList(f: Finding): HTMLElement | null {
    if (!f.evidence.length) return null;
    return h(
      'ul',
      { class: 'evidence' },
      ...f.evidence.map((e) => {
        if (!e.url) return h('li', { class: 'more' }, e.text);
        const where = /^https?:/.test(e.url)
          ? !linkPages
            ? h('span', { class: 'where' }, shortUrl(e.url))
            : h('a', { class: 'where', href: e.url, target: '_blank', rel: 'noopener noreferrer' }, shortUrl(e.url))
          : h('span', { class: 'where' }, e.url);
        return h('li', {}, where, e.kind === 'note' ? h('span', {}, e.text) : h('q', {}, e.text));
      }),
    );
  }

  function findingCard(f: Finding): HTMLElement {
    return h(
      'article',
      { class: `finding sev-${f.severity}`, 'data-id': f.id },
      h('p', { class: 'tags' }, h('span', { class: `badge sev-${f.severity}` }, SEVERITY_LABEL[f.severity]), h('span', { class: 'area' }, AREA_LABEL[f.area])),
      h('h4', {}, f.title),
      h('p', {}, f.detail),
      evidenceList(f),
      h('p', { class: 'fix' }, h('strong', {}, 'What to do: '), f.fix),
    );
  }

  function diffBox(d: Comparison): HTMLElement {
    const list = (items: Comparison['fixed'], empty: string) =>
      items.length ? h('ul', {}, ...items.map((f) => h('li', {}, f.title))) : h('p', { class: 'hint' }, empty);
    return h(
      'section',
      { class: 'diff', id: 'diff', 'aria-labelledby': 'diff-title' },
      h('h3', { id: 'diff-title' }, `Since your check on ${fmt(d.previous.checkedAt)}`),
      h('p', {}, `${d.fixed.length} fixed, ${d.added.length} new, ${d.still.length} still open.`),
      h('div', { class: 'diff-cols' }, h('div', {}, h('h4', {}, 'Fixed'), list(d.fixed, 'Nothing fixed since then.')), h('div', {}, h('h4', {}, 'New'), list(d.added, 'Nothing new.'))),
    );
  }

  function factsTable(r: ScanResult): HTMLElement {
    const rows = factRows(r.pages);
    const cell = (t: string) => h('td', {}, t || '–');
    return h(
      'details',
      { class: 'facts' },
      h('summary', {}, `What each page says (${rows.length} pages)`),
      h(
        'div',
        { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'What each page says' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ...['Page', 'Type', 'Contact details', 'Shipping', 'Returns', 'Price and stock'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, ...rows.map((row) => h('tr', {}, h('th', { scope: 'row' }, shortUrl(row.url)), cell(row.kind), cell(row.contact), cell(row.shipping), cell(row.returns), cell(row.price)))),
        ),
      ),
    );
  }

  function showResults(r: ScanResult, diff?: Comparison): void {
    const count = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
    const reportButton = h('button', { type: 'button', class: 'secondary', id: 'download-report' }, 'Download the report');
    reportButton.addEventListener('click', () => {
      download(`preflight-${shortUrl(r.site).replace(/ .*/, '')}-${r.checkedAt.slice(0, 10)}.md`, markdownReport(r, diff), 'text/markdown');
    });
    const printButton = h('button', { type: 'button', class: 'secondary', id: 'print' }, 'Print');
    printButton.addEventListener('click', () => print());
    const notRead = [
      // Addresses the checker guessed (a platform's usual policy page) are not the owner's links.
      ...r.errors.filter((e) => !e.guessed).map((e) => h('li', {}, `${shortUrl(e.url)}: ${e.error}`)),
      ...r.skippedByRobots.map((u) => h('li', {}, `${shortUrl(u)}: skipped, the store’s robots.txt asks crawlers not to read it.`)),
    ];
    const groups = (['high', 'medium', 'low'] as Severity[])
      .map((sev) => {
        const list = r.findings.filter((f) => f.severity === sev);
        if (!list.length) return null;
        return h('section', { class: `group sev-${sev}` }, h('h3', {}, `${SEVERITY_LABEL[sev]} (${list.length})`), ...list.map(findingCard));
      })
      .filter(Boolean) as HTMLElement[];
    const parts: Array<HTMLElement | null> = [
      h('h2', { id: 'results-title', tabindex: '-1' }, `Results for ${shortUrl(r.site).replace(' (home page)', '')}`),
      h(
        'p',
        { class: 'summary', id: 'summary' },
        r.findings.length
          ? `${r.pages.length} pages read. ${count('high')} to fix first, ${count('medium')} to fix soon, ${count('low')} worth a look.`
          : `${r.pages.length} pages read. No contradictions were found on the pages read.`,
      ),
      r.feed ? h('p', { class: 'hint' }, `Product feed: ${r.feed.items} products read.${r.feed.warnings.length ? ` ${r.feed.warnings.join(' ')}` : ''}`) : null,
      diff ? diffBox(diff) : null,
      ...groups,
      factsTable(r),
      notRead.length ? h('details', { class: 'not-read' }, h('summary', {}, `Pages not read (${notRead.length})`), h('ul', {}, ...notRead)) : null,
      r.readDespiteRobots.length
        ? h('p', { class: 'hint' }, `Read although the store’s robots.txt asks search engines to skip them, because you confirmed the store is yours and these are the pages reviewers read: ${r.readDespiteRobots.map(shortUrl).join(', ')}.`)
        : null,
      h('div', { class: 'actions' }, reportButton, printButton),
      h('p', { class: 'disclaimer' }, DISCLAIMER),
    ];
    results.replaceChildren(...(parts.filter(Boolean) as HTMLElement[]));
    results.hidden = false;
    (results.querySelector('#results-title') as HTMLElement).focus();
  }

  function renderLog(): void {
    if (!log.length) {
      logBox.replaceChildren(
        h('h2', { id: 'log-title' }, 'Your re-check log'),
        h('p', { class: 'hint' }, storage ? 'Every check you run is listed here with its date, so you can show what you fixed before you request a review. The log stays in this browser.' : 'This browser is not letting the page save anything, so the re-check log is off.'),
      );
      return;
    }
    const rows = [...log].reverse().map((e) => {
      const note = h('input', { type: 'text', value: e.note, 'aria-label': `Note for the check of ${e.site} on ${fmt(e.checkedAt)}`, placeholder: 'What you changed', class: 'note' });
      note.addEventListener('change', () => {
        log = setNote(log, e.id, note.value);
        saveLog(storage, log);
      });
      const del = h('button', { type: 'button', class: 'link', 'aria-label': `Remove the check of ${e.site} on ${fmt(e.checkedAt)}` }, 'Remove');
      del.addEventListener('click', () => {
        log = removeEntry(log, e.id);
        saveLog(storage, log);
        renderLog();
      });
      return h('tr', {}, h('td', {}, fmt(e.checkedAt)), h('td', {}, e.site), h('td', {}, String(e.pagesRead)), h('td', {}, `${e.counts.high} fix first, ${e.counts.medium} soon, ${e.counts.low} look`), h('td', {}, note), h('td', {}, del));
    });
    const csv = h('button', { type: 'button', class: 'secondary', id: 'download-log' }, 'Download the log (CSV)');
    csv.addEventListener('click', () => download('preflight-log.csv', logCsv(log), 'text/csv'));
    const clear = h('button', { type: 'button', class: 'secondary', id: 'clear-log' }, 'Clear the log');
    clear.addEventListener('click', () => {
      if (!window.confirm('Remove every check from this browser’s log?')) return;
      log = [];
      saveLog(storage, log);
      renderLog();
    });
    logBox.replaceChildren(
      h('h2', { id: 'log-title' }, 'Your re-check log'),
      h('p', { class: 'hint' }, 'A dated record of every check, kept in this browser. Add a note on what you changed; the next check of the same store shows what was fixed.'),
      h(
        'div',
        { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Re-check log' },
        h('table', {}, h('thead', {}, h('tr', {}, ...['Checked', 'Store', 'Pages', 'Found', 'Note', ''].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, ...rows)),
      ),
      h('div', { class: 'actions' }, csv, clear),
    );
  }

  renderLog();
  return {
    runDemo,
    runSite,
    get log() {
      return log;
    },
  };
}
