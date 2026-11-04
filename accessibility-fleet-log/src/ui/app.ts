import { toCsv } from '../core/csv';
import { csvHeaders, foreignPages, guessCsvMapping, importResults, matchSite, type CsvMapping, type ImportResult } from '../core/importers';
import {
  buildLog,
  fleetCriteria,
  fleetSummary,
  siteChecks,
  siteRow,
  sortIssues,
  sortRows,
  type Issue,
  type SiteRow,
  type SortKey,
  type StatementState,
} from '../core/log';
import { emptyFleet, emptySite, isDate, newId, parseFleet, removeSite, serializeFleet, todayIso, type Check, type Fleet, type Jurisdiction, type Site } from '../core/model';
import { monthlyReport, reportHtml, reportMonths } from '../core/report';
import { sampleFleet } from '../core/sample';
import { bookmarklet, consoleSnippet, AXE_TAGS, AXE_VERSION } from '../core/snippet';
import { buildStatement, diffLines, statementHtml, statementText, statusLabel, type StatementDoc } from '../core/statement';
import { criterion } from '../core/wcag';
import { download, h } from './dom';

export type TabId = 'fleet' | 'site' | 'add' | 'reports' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'fleet', label: 'All sites' },
  { id: 'site', label: 'Site log' },
  { id: 'add', label: 'Add results' },
  { id: 'reports', label: 'Client reports' },
  { id: 'settings', label: 'Your details and backup' },
];

export const STORAGE_KEY = 'accessibility-fleet-log:v1';

export interface MountOptions {
  now?: () => Date;
  /** Pass null to disable saving in the browser. */
  storage?: Storage | null;
  confirm?: (msg: string) => boolean;
  copy?: (text: string) => Promise<void>;
  print?: (frame: HTMLIFrameElement) => void;
}

export interface App {
  fleet(): Fleet;
  setFleet(f: Fleet, message?: string): void;
  openTab(id: TabId, siteId?: string): void;
}

function safeStorage(s: Storage | null | undefined): Storage | null {
  if (s === null) return null;
  try {
    return s ?? window.localStorage;
  } catch {
    return null;
  }
}

const STATEMENT_LABEL: Record<StatementState, [string, string]> = {
  none: ['None yet', 'bad'],
  current: ['Up to date', 'good'],
  outdated: ['Newer check since', 'warn'],
  old: ['Over a year old', 'bad'],
};

function badge(text: string, kind: string): HTMLElement {
  return h('span', { class: `badge ${kind}` }, text);
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function siteLabel(s: Site): string {
  return s.name.trim() || s.url.trim() || 'Unnamed site';
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

export function mount(root: HTMLElement, options: MountOptions = {}): App {
  const now = options.now ?? (() => new Date());
  const storage = safeStorage(options.storage);
  const confirmFn = options.confirm ?? ((m: string) => window.confirm(m));
  const copyFn = options.copy ?? ((t: string) => navigator.clipboard.writeText(t));
  const printFn =
    options.print ??
    ((frame: HTMLIFrameElement) => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    });

  let fleet: Fleet = emptyFleet();
  let tab: TabId = 'fleet';
  let siteId = '';
  let sort: SortKey = 'attention';
  let issueFilter: 'open' | 'fixed' | 'all' = 'open';
  let diffFor: number | null = null;
  let reportMonth = '';
  let message = '';
  let saveFailed = false;
  // Add-results state
  let pasted = '';
  let pageUrl = '';
  let checkDate = '';
  let pending: ImportResult | null = null;
  let pendingSite = '';
  let mapping: CsvMapping | null = null;
  let csvFailed = false;

  const today = () => todayIso(now());

  if (storage) {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved) fleet = parseFleet(saved);
    } catch {
      message = 'The saved fleet in this browser could not be read, so the app started empty.';
    }
  }

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, serializeFleet(fleet));
      saveFailed = false;
    } catch {
      saveFailed = true;
    }
  }

  function setFleet(f: Fleet, msg = ''): void {
    fleet = f;
    if (!fleet.sites.some((s) => s.id === siteId)) siteId = fleet.sites[0]?.id ?? '';
    persist();
    message = msg;
    render();
  }

  function say(msg: string): void {
    message = msg;
    render();
  }

  function currentSite(): Site | undefined {
    return fleet.sites.find((s) => s.id === siteId) ?? fleet.sites[0];
  }

  function openTab(id: TabId, sid?: string): void {
    tab = id;
    if (sid) siteId = sid;
    diffFor = null;
    message = '';
    render();
    root.querySelector<HTMLElement>('#panel h2')?.focus();
  }

  function updateSite(id: string, patch: Partial<Site>): void {
    fleet = { ...fleet, sites: fleet.sites.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
    persist();
  }

  // ---------- shared pieces ----------

  function siteSelect(id: string, value: string, onPick: (v: string) => void): HTMLSelectElement {
    const sel = h('select', { id, onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value) });
    for (const s of [...fleet.sites].sort((a, b) => siteLabel(a).localeCompare(siteLabel(b)))) {
      const o = h('option', { value: s.id }, `${siteLabel(s)}${s.client && s.client !== s.name ? ` (${s.client})` : ''}`);
      if (s.id === value) o.selected = true;
      sel.append(o);
    }
    return sel;
  }

  function noSites(): HTMLElement {
    return h(
      'div',
      { class: 'empty' },
      h('p', {}, 'No client sites yet. Add one on the All sites tab, or look around with the demo fleet first.'),
      h('button', { type: 'button', onclick: () => openTab('fleet') }, 'Go to All sites'),
    );
  }

  // ---------- All sites ----------

  function addSiteForm(open: boolean): HTMLElement {
    const name = h('input', { id: 'new-name', type: 'text', autocomplete: 'off' });
    const client = h('input', { id: 'new-client', type: 'text', autocomplete: 'off' });
    const url = h('input', { id: 'new-url', type: 'url', placeholder: 'https://', autocomplete: 'off' });
    const form = h(
      'form',
      {
        class: 'add-site',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const u = url.value.trim();
          if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(u)) {
            say('Type the site address starting with https://');
            return;
          }
          const s: Site = { ...emptySite(newId('site')), name: name.value.trim() || u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''), client: client.value.trim(), url: u.replace(/\/+$/, ''), owner: client.value.trim() };
          siteId = s.id;
          setFleet({ ...fleet, sites: [...fleet.sites, s] }, `Added ${siteLabel(s)}. Next: add its first check results.`);
        },
      },
      h('div', { class: 'row3' }, field('Site name', name), field('Client', client), field('Address', url)),
      h('button', { type: 'submit', class: 'primary' }, 'Add site'),
    );
    const d = h('details', { class: 'card' }, h('summary', {}, 'Add a client site'), form);
    d.open = open;
    return d;
  }

  function trendCell(r: SiteRow): HTMLElement {
    if (r.trend === null) return h('td', {}, '–');
    if (r.trend === 0) return h('td', {}, 'no change');
    return h('td', { class: r.trend > 0 ? 'worse' : 'better' }, r.trend > 0 ? `+${r.trend} more` : `${-r.trend} fewer`);
  }

  function fleetPanel(): HTMLElement {
    const panel = h('div', {});
    panel.append(h('h2', { tabindex: '-1' }, 'All client sites'));
    if (fleet.sites.length === 0) {
      panel.append(
        h(
          'div',
          { class: 'card intro' },
          h('p', {}, 'Add each website you look after, then paste in the results of a free accessibility checker every month. The log keeps the dates: when each problem was found and when it was fixed. From that you get a draft accessibility statement for every site and a monthly report with your name on it.'),
          h('button', { type: 'button', class: 'primary', onclick: () => setFleet(sampleFleet(today()), 'Loaded a demo fleet: six made-up client sites with four months of checks.') }, 'Try the demo fleet'),
        ),
        addSiteForm(true),
      );
      return panel;
    }
    const rows = sortRows(
      fleet.sites.map((s) => siteRow(fleet, s, today())),
      sort,
    );
    const sum = fleetSummary(rows);
    const tile = (n: number, label: string, kind = '') => h('div', { class: `tile ${kind}` }, h('b', {}, String(n)), h('span', {}, label));
    panel.append(
      h(
        'div',
        { class: 'tiles', role: 'list', 'aria-label': 'Fleet summary' },
        ...[
          tile(sum.sites, sum.sites === 1 ? 'site' : 'sites'),
          tile(sum.open, 'open issues'),
          tile(sum.critical, 'critical', sum.critical > 0 ? 'bad' : ''),
          tile(sum.due, 'checks due', sum.due > 0 ? 'warn' : ''),
          tile(sum.statementsToUpdate, 'statements to update', sum.statementsToUpdate > 0 ? 'warn' : ''),
          tile(sum.fixed30, 'fixed in 30 days', sum.fixed30 > 0 ? 'good' : ''),
        ].map((t) => {
          t.setAttribute('role', 'listitem');
          return t;
        }),
      ),
    );
    const sortSel = h('select', {
      id: 'sort',
      onchange: (e: Event) => {
        sort = (e.target as HTMLSelectElement).value as SortKey;
        render();
      },
    });
    for (const [v, l] of [
      ['attention', 'Needs attention first'],
      ['open', 'Most open issues'],
      ['lastCheck', 'Longest since checked'],
      ['name', 'Name'],
    ] as [SortKey, string][]) {
      const o = h('option', { value: v }, l);
      if (v === sort) o.selected = true;
      sortSel.append(o);
    }
    panel.append(h('div', { class: 'toolbar' }, h('label', { for: 'sort' }, 'Sort by '), sortSel));
    const table = h(
      'table',
      { class: 'fleet' },
      h('caption', { class: 'sr-only' }, 'Client sites with their accessibility status'),
      h(
        'thead',
        {},
        h('tr', {}, ...['Site', 'Last check', 'Open issues', 'Critical', 'Since previous check', 'Fixed (30 days)', 'Statement'].map((t) => h('th', { scope: 'col' }, t))),
      ),
    );
    const tbody = h('tbody', {});
    for (const r of rows) {
      const [stText, stKind] = STATEMENT_LABEL[r.statement];
      tbody.append(
        h(
          'tr',
          {},
          h(
            'th',
            { scope: 'row' },
            h('button', { type: 'button', class: 'linkish', onclick: () => openTab('site', r.site.id) }, siteLabel(r.site)),
            r.site.client && r.site.client !== r.site.name ? h('span', { class: 'sub' }, r.site.client) : null,
          ),
          h('td', {}, r.lastCheck ? shortDate(r.lastCheck) : 'never', ' ', r.due ? badge('check due', 'warn') : null),
          h('td', {}, String(r.open), r.open !== r.openTarget ? h('span', { class: 'sub' }, `${r.openTarget} against WCAG ${r.site.target} AA`) : null),
          h('td', { class: r.critical > 0 ? 'worse' : '' }, String(r.critical)),
          trendCell(r),
          h('td', {}, String(r.fixed30)),
          h('td', {}, badge(stText, stKind), r.statementDate ? h('span', { class: 'sub' }, shortDate(r.statementDate)) : null),
        ),
      );
    }
    table.append(tbody);
    panel.append(h('div', { class: 'scroll' }, table));

    const common = fleetCriteria(fleet).slice(0, 8);
    if (common.length > 0) {
      panel.append(
        h('h3', {}, 'Problems that come up across clients'),
        h('p', { class: 'hint' }, 'Fixing one of these in a shared theme or plugin can clear it on several sites at once.'),
        h(
          'ul',
          { class: 'common' },
          ...common.map((c) => {
            const cr = criterion(c.id);
            return h('li', {}, h('strong', {}, cr ? `${c.id} ${cr.name}` : 'Best practice (no WCAG rule)'), `: ${c.issues} open issue${c.issues === 1 ? '' : 's'} on ${c.sites} site${c.sites === 1 ? '' : 's'}`);
          }),
        ),
      );
    }
    panel.append(addSiteForm(false));
    return panel;
  }

  // ---------- Site log ----------

  function siteForm(s: Site): HTMLElement {
    const text = (id: keyof Site, label: string, type = 'text', hint?: string) => {
      const input = h('input', {
        id: `site-${id}`,
        type,
        value: String(s[id]),
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          if (id === 'manualReview' && v !== '' && !isDate(v)) return;
          updateSite(s.id, { [id]: v } as Partial<Site>);
        },
      });
      if (hint) input.setAttribute('aria-describedby', `site-${id}-hint`);
      return field(label, input, hint);
    };
    const jur = h('select', { id: 'site-jurisdiction', onchange: (e: Event) => updateSite(s.id, { jurisdiction: (e.target as HTMLSelectElement).value as Jurisdiction }) });
    for (const [v, l] of [
      ['both', 'EU and US visitors'],
      ['eu', 'EU (European Accessibility Act, BFSG)'],
      ['us', 'US (ADA)'],
    ]) {
      const o = h('option', { value: v }, l);
      if (v === s.jurisdiction) o.selected = true;
      jur.append(o);
    }
    const target = h('select', { id: 'site-target', onchange: (e: Event) => updateSite(s.id, { target: (e.target as HTMLSelectElement).value === '2.2' ? '2.2' : '2.1' }) });
    for (const v of ['2.1', '2.2']) {
      const o = h('option', { value: v }, `WCAG ${v} AA`);
      if (v === s.target) o.selected = true;
      target.append(o);
    }
    const limits = h('textarea', { id: 'site-knownLimits', rows: '3', onchange: (e: Event) => updateSite(s.id, { knownLimits: (e.target as HTMLTextAreaElement).value }) });
    limits.value = s.knownLimits;
    return h(
      'details',
      { class: 'card' },
      h('summary', {}, 'Site details used in the statement'),
      h(
        'div',
        { class: 'grid2' },
        text('name', 'Site name'),
        text('client', 'Client'),
        text('url', 'Address', 'url'),
        text('owner', 'Published by', 'text', 'The legal name of the business that owns the site.'),
        text('contactEmail', 'Accessibility contact email', 'email'),
        text('manualReview', 'Last review by a person', 'date', 'Leave empty if nobody has tested the site by hand (keyboard, screen reader) in the last year.'),
        field('Visitors from', jur),
        field('Standard', target),
      ),
      field('Other content that may not be fully accessible', limits, 'Optional. For example a third-party booking widget or old PDF menus.'),
      h('p', { class: 'hint' }, 'Changes are saved as you go. Remove the site and all its history: ', h('button', { type: 'button', class: 'danger small', onclick: () => {
        if (!confirmFn(`Remove ${siteLabel(s)} and all of its checks, notes and statements?`)) return;
        setFleet(removeSite(fleet, s.id), `Removed ${siteLabel(s)}.`);
      } }, 'Remove site')),
    );
  }

  function checksList(s: Site): HTMLElement {
    const checks = siteChecks(fleet, s.id).reverse();
    if (checks.length === 0) return h('p', {}, 'No checks yet. ', h('button', { type: 'button', class: 'linkish', onclick: () => openTab('add', s.id) }, 'Add the first results'), '.');
    return h(
      'ul',
      { class: 'checks' },
      ...checks.map((c: Check) => {
        const n = c.pages.reduce((k, p) => k + p.findings.length, 0);
        return h(
          'li',
          {},
          `${shortDate(c.date)}: ${c.engine}, ${c.pages.length} page${c.pages.length === 1 ? '' : 's'}, ${n} failing rule${n === 1 ? '' : 's'} `,
          h(
            'button',
            {
              type: 'button',
              class: 'small',
              'aria-label': `Delete the check of ${shortDate(c.date)}`,
              onclick: () => {
                if (!confirmFn(`Delete the check of ${shortDate(c.date)}? Found and fixed dates are worked out again without it.`)) return;
                setFleet({ ...fleet, checks: fleet.checks.filter((x) => x.id !== c.id) }, `Deleted the check of ${shortDate(c.date)}.`);
              },
            },
            'Delete',
          ),
        );
      }),
    );
  }

  function noteCell(i: Issue): HTMLElement {
    const note = fleet.notes[i.key] ?? '';
    const input = h('input', {
      type: 'text',
      class: 'note',
      value: note,
      'aria-label': `Note for ${i.help} on ${pathOf(i.pageUrl)}`,
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.trim();
        const notes = { ...fleet.notes };
        if (v) notes[i.key] = v;
        else delete notes[i.key];
        fleet = { ...fleet, notes };
        persist();
      },
    });
    return h('td', {}, input);
  }

  function issueTable(s: Site): HTMLElement {
    const all = sortIssues(buildLog(fleet, s));
    const list = all.filter((i) => issueFilter === 'all' || i.status === issueFilter);
    const filter = h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Show issues' });
    for (const [v, l] of [
      ['open', `Open (${all.filter((i) => i.status === 'open').length})`],
      ['fixed', `Fixed (${all.filter((i) => i.status === 'fixed').length})`],
      ['all', `All (${all.length})`],
    ] as const) {
      filter.append(
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': issueFilter === v ? 'true' : 'false',
            onclick: () => {
              issueFilter = v;
              render();
            },
          },
          l,
        ),
      );
    }
    filter.append(
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            const rows: (string | number)[][] = [['Status', 'Rule', 'Description', 'WCAG', 'Counts against target', 'Impact', 'Page', 'Elements', 'Found', 'Fixed', 'Note']];
            for (const i of all) rows.push([i.status, i.ruleId, i.help, i.criteria.join(' '), i.scope === 'target' ? 'yes' : 'no', i.impact ?? '', i.pageUrl, i.count, i.firstFound, i.fixedOn ?? '', fleet.notes[i.key] ?? '']);
            download(`${slugify(siteLabel(s))}-issue-log.csv`, toCsv(rows), 'text/csv');
          },
        },
        'Download issue log (CSV)',
      ),
    );
    if (list.length === 0) return h('div', {}, filter, h('p', {}, issueFilter === 'fixed' ? 'Nothing fixed yet.' : all.length === 0 ? 'No issues logged.' : 'No open issues.'));
    const table = h(
      'table',
      { class: 'issues' },
      h('caption', { class: 'sr-only' }, `Issue log for ${siteLabel(s)}`),
      h('thead', {}, h('tr', {}, ...['Issue', 'WCAG', 'Page', 'Found', 'Fixed', 'Note'].map((t) => h('th', { scope: 'col' }, t)))),
    );
    const tb = h('tbody', {});
    for (const i of list) {
      const wc = i.criteria.length > 0 ? i.criteria.join(', ') : 'best practice';
      const reopened = i.events.some((e) => e.kind === 'reopened');
      tb.append(
        h(
          'tr',
          { class: i.status },
          h('td', {}, i.impact ? badge(i.impact, i.impact === 'critical' || i.impact === 'serious' ? 'bad' : 'warn') : null, ' ', i.help, h('span', { class: 'sub' }, `${i.ruleId} · ${i.count} element${i.count === 1 ? '' : 's'}`), reopened ? badge('came back', 'warn') : null),
          h('td', {}, wc, i.scope === 'beyond' ? h('span', { class: 'sub' }, `beyond WCAG ${s.target}`) : null),
          h('td', { class: 'path' }, pathOf(i.pageUrl)),
          h('td', {}, shortDate(i.firstFound)),
          h('td', {}, i.fixedOn ? shortDate(i.fixedOn) : '–'),
          noteCell(i),
        ),
      );
    }
    table.append(tb);
    return h('div', {}, filter, h('div', { class: 'scroll' }, table));
  }

  function statementView(doc: StatementDoc): HTMLElement {
    const box = h('article', { class: 'statement', 'aria-label': 'Statement preview' }, h('h4', {}, doc.title));
    for (const s of doc.sections) {
      box.append(h('h5', {}, s.heading));
      for (const p of s.paragraphs) box.append(h('p', {}, p));
      if (s.bullets && s.bullets.length > 0) box.append(h('ul', {}, ...s.bullets.map((b) => h('li', {}, b))));
    }
    return box;
  }

  function statementPanel(s: Site): HTMLElement {
    const doc = buildStatement(fleet, s, today());
    const text = statementText(doc);
    const versions = fleet.statements.map((v, i) => ({ v, i })).filter(({ v }) => v.siteId === s.id);
    const latest = versions.length > 0 ? versions[versions.length - 1].v : null;
    const changed = !latest || latest.text !== text;
    const kind = doc.status === 'partial' ? 'warn' : doc.status === 'believed' ? 'good' : 'neutral';
    const copy = (t: string, what: string) =>
      copyFn(t).then(
        () => say(`Copied the statement as ${what}.`),
        () => say('Copying was blocked by the browser. Select the text in the preview and copy it by hand.'),
      );
    const wrap = h(
      'section',
      { 'aria-labelledby': 'st-h' },
      h('h3', { id: 'st-h' }, 'Accessibility statement'),
      h('p', {}, 'Status: ', badge(statusLabel(doc.status), kind), ' ', latest ? `Last saved version: ${shortDate(latest.date)}.` : 'No version saved yet.', changed && latest ? ' The draft below differs from it.' : ''),
      h('p', { class: 'hint' }, 'This is a draft for the site owner to read and adopt. It is not legal advice, and it never claims more than the checks show.'),
      h(
        'div',
        { class: 'toolbar' },
        h('button', { type: 'button', onclick: () => void copy(statementHtml(doc), 'HTML') }, 'Copy as HTML'),
        h('button', { type: 'button', onclick: () => void copy(text, 'text') }, 'Copy as text'),
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            disabled: !changed,
            onclick: () => setFleet({ ...fleet, statements: [...fleet.statements, { siteId: s.id, date: today(), text }] }, `Saved the statement for ${siteLabel(s)} as the version of ${shortDate(today())}.`),
          },
          changed ? 'Save as new dated version' : 'Saved version is current',
        ),
      ),
      statementView(doc),
    );
    if (versions.length > 0) {
      const hist = h('ol', { class: 'versions', reversed: true });
      versions
        .slice()
        .reverse()
        .forEach(({ v, i }, k) => {
          const prev = versions[versions.length - 2 - k]?.v ?? null;
          const li = h(
            'li',
            {},
            shortDate(v.date),
            ' ',
            h('button', { type: 'button', class: 'small', onclick: () => download(`${slugify(siteLabel(s))}-statement-${v.date}.txt`, v.text, 'text/plain') }, 'Download'),
            ' ',
            prev
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'small',
                    'aria-expanded': diffFor === i ? 'true' : 'false',
                    onclick: () => {
                      diffFor = diffFor === i ? null : i;
                      render();
                    },
                  },
                  'What changed',
                )
              : null,
          );
          if (prev && diffFor === i) {
            const lines = diffLines(prev.text, v.text).filter((d) => d.kind !== 'same' && d.text.trim() !== '');
            li.append(
              lines.length === 0
                ? h('p', {}, 'No text changes.')
                : h('ul', { class: 'diff' }, ...lines.map((d) => h('li', { class: d.kind }, h('span', { class: 'sr-only' }, d.kind === 'added' ? 'Added: ' : 'Removed: '), d.text))),
            );
          }
          hist.append(li);
        });
      wrap.append(h('h4', {}, 'Saved versions'), hist);
    }
    return wrap;
  }

  function sitePanel(): HTMLElement {
    const panel = h('div', {});
    panel.append(h('h2', { tabindex: '-1' }, 'Site log'));
    const s = currentSite();
    if (!s) {
      panel.append(noSites());
      return panel;
    }
    siteId = s.id;
    panel.append(
      h(
        'div',
        { class: 'toolbar' },
        h('label', { for: 'site-pick' }, 'Site '),
        siteSelect('site-pick', s.id, (v) => {
          siteId = v;
          diffFor = null;
          render();
        }),
        h('button', { type: 'button', onclick: () => openTab('add', s.id) }, 'Add results'),
        h('button', { type: 'button', onclick: () => openTab('reports', s.id) }, 'Client report'),
      ),
      siteForm(s),
      h('h3', {}, 'Checks'),
      checksList(s),
      h('h3', {}, 'Issue log'),
      issueTable(s),
      statementPanel(s),
    );
    return panel;
  }

  // ---------- Add results ----------

  function addPanel(): HTMLElement {
    const panel = h('div', {});
    panel.append(h('h2', { tabindex: '-1' }, 'Add check results'));
    if (fleet.sites.length === 0) {
      panel.append(noSites());
      return panel;
    }
    if (!pendingSite || !fleet.sites.some((s) => s.id === pendingSite)) pendingSite = currentSite()?.id ?? '';
    const ta = h('textarea', {
      id: 'paste',
      rows: '8',
      spellcheck: 'false',
      oninput: (e: Event) => {
        pasted = (e.target as HTMLTextAreaElement).value;
      },
    });
    ta.value = pasted;
    const file = h('input', {
      id: 'file',
      type: 'file',
      accept: '.json,.csv,.txt,application/json,text/csv',
      onchange: async (e: Event) => {
        const fl = (e.target as HTMLInputElement).files?.[0];
        if (!fl) return;
        pasted = await fl.text();
        mapping = null;
        preview();
      },
    });
    const urlIn = h('input', {
      id: 'page-url',
      type: 'url',
      placeholder: 'https://',
      value: pageUrl,
      onchange: (e: Event) => {
        pageUrl = (e.target as HTMLInputElement).value.trim();
      },
    });
    const dateIn = h('input', {
      id: 'check-date',
      type: 'date',
      value: checkDate,
      onchange: (e: Event) => {
        checkDate = (e.target as HTMLInputElement).value;
      },
    });
    panel.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'grid2' }, field('Site', siteSelect('add-site', pendingSite, (v) => (pendingSite = v))), field('Date of the check', dateIn, 'Leave empty to use the date in the file, or today.')),
        field('Paste results', ta, 'axe-core JSON (browser extension, the snippet below, @axe-core/cli), pa11y or pa11y-ci JSON, Lighthouse JSON, or a CSV with a page column and an issue column.'),
        field('Or choose a file', file),
        field('Page address', urlIn, 'Only needed when the file does not say which page it checked (plain pa11y JSON, some CSVs).'),
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            onclick: () => {
              mapping = null;
              preview();
            },
          },
          'Preview',
        ),
      ),
    );
    if (pending) panel.append(previewCard(pending));
    else if (csvFailed) {
      panel.append(
        h('section', { class: 'card preview', 'aria-labelledby': 'map-h' }, h('h3', { id: 'map-h' }, 'Which column is which?'), h('p', {}, 'Pick the columns of your file, and the preview appears.'), mappingControls()),
      );
    }
    panel.append(howTo());
    return panel;
  }

  function preview(): void {
    try {
      pending = importResults(pasted, { pageUrl: pageUrl || undefined, csvMapping: mapping ?? undefined });
      const m = matchSite(fleet, pending.pages);
      if (m) pendingSite = m;
      message = '';
      csvFailed = false;
    } catch (e) {
      pending = null;
      message = (e as Error).message;
      const t = pasted.trim();
      csvFailed = t !== '' && !t.startsWith('{') && !t.startsWith('[') && csvHeaders(t).length > 1;
    }
    render();
  }

  function previewCard(r: ImportResult): HTMLElement {
    const site = fleet.sites.find((s) => s.id === pendingSite);
    const rules = r.pages.reduce((k, p) => k + p.findings.length, 0);
    const foreign = site ? foreignPages(site.url, r.pages) : [];
    const date = checkDate || r.date || today();
    const card = h(
      'section',
      { class: 'card preview', 'aria-labelledby': 'pv-h' },
      h('h3', { id: 'pv-h' }, 'Preview'),
      h('p', {}, `${r.engine}: ${r.pages.length} page${r.pages.length === 1 ? '' : 's'}, ${rules} failing rule${rules === 1 ? '' : 's'}. It will be logged for ${site ? siteLabel(site) : '?'} on ${shortDate(date)}.`),
      ...r.notes.map((n) => h('p', { class: 'hint' }, n)),
      foreign.length > 0 ? h('p', { class: 'warnbox' }, `${foreign.length} page${foreign.length === 1 ? ' is' : 's are'} not on ${site?.url}: ${foreign.slice(0, 3).join(', ')}. Check you picked the right site.`) : null,
      h('ul', { class: 'pv' }, ...r.pages.slice(0, 12).map((p) => h('li', {}, `${pathOf(p.url)}: ${p.findings.length === 0 ? 'no failures' : p.findings.map((f) => f.ruleId).join(', ')}`))),
    );
    if (r.format === 'csv') card.append(mappingControls());
    card.append(
      h(
        'button',
        {
          type: 'button',
          class: 'primary',
          onclick: () => {
            if (!site) return;
            const check: Check = { id: newId('check'), siteId: site.id, date, engine: r.engine, pages: r.pages };
            pending = null;
            pasted = '';
            siteId = site.id;
            tab = 'site';
            setFleet({ ...fleet, checks: [...fleet.checks, check] }, `Logged the check of ${shortDate(date)} for ${siteLabel(site)}.`);
          },
        },
        'Add this check to the log',
      ),
    );
    return card;
  }

  function mappingControls(): HTMLElement {
    const headers = csvHeaders(pasted);
    const m = mapping ?? guessCsvMapping(headers);
    const box = h('fieldset', { class: 'mapping' }, h('legend', {}, 'Columns used'));
    const labels: [keyof CsvMapping, string][] = [
      ['url', 'Page'],
      ['rule', 'Rule or issue'],
      ['help', 'Description'],
      ['criteria', 'WCAG criterion'],
      ['impact', 'Severity'],
      ['count', 'Count'],
      ['status', 'Status (ignored rows skipped)'],
    ];
    for (const [k, l] of labels) {
      const sel = h('select', {
        id: `map-${k}`,
        onchange: (e: Event) => {
          mapping = { ...m, [k]: Number((e.target as HTMLSelectElement).value) };
          preview();
        },
      });
      sel.append(h('option', { value: '-1' }, '(none)'));
      headers.forEach((hd, i) => {
        const o = h('option', { value: String(i) }, hd || `Column ${i + 1}`);
        if (m[k] === i) o.selected = true;
        sel.append(o);
      });
      box.append(field(l, sel));
    }
    return box;
  }

  function howTo(): HTMLElement {
    const snippet = consoleSnippet();
    const copy = (t: string, what: string) =>
      copyFn(t).then(
        () => say(`Copied the ${what}.`),
        () => say('Copying was blocked by the browser. Select the text and copy it by hand.'),
      );
    const bm = h('a', { href: bookmarklet(), class: 'bookmarklet' }, 'Fleet Log check');
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'how-h' },
      h('h3', { id: 'how-h' }, 'Getting results without installing anything on client sites'),
      h('p', {}, 'Each way below runs the free axe-core checker (version ', AXE_VERSION, ') in your own browser, against the WCAG A and AA rules. Only the failing rule names, element counts and page address are kept.'),
      h('h4', {}, '1. Bookmark'),
      h('p', {}, 'Drag this link to your bookmarks bar: ', bm, '. Open a client page, click the bookmark, then paste here. Some sites block it with a security policy; use the console snippet instead.'),
      h('h4', {}, '2. Console snippet'),
      h('p', {}, 'Open the page, press F12, choose Console, paste this and press Enter. The results are copied for you.'),
      h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Console snippet' }, snippet),
      h('button', { type: 'button', onclick: () => void copy(snippet, 'console snippet') }, 'Copy snippet'),
      h('h4', {}, '3. Terminal, many pages at once'),
      h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Terminal commands' }, `npx @axe-core/cli@${AXE_VERSION} https://client.example/ https://client.example/contact --tags ${AXE_TAGS.join(',')} --save results.json\nnpx pa11y-ci --json https://client.example/ https://client.example/contact > results.json`),
      h('p', { class: 'hint' }, 'Lighthouse JSON (Chrome DevTools > Lighthouse > Save as JSON) and CSV exports from other checkers work too.'),
    );
  }

  // ---------- Client reports ----------

  function reportsPanel(): HTMLElement {
    const panel = h('div', {});
    panel.append(h('h2', { tabindex: '-1' }, 'Monthly client report'));
    const s = currentSite();
    if (!s) {
      panel.append(noSites());
      return panel;
    }
    siteId = s.id;
    const months = reportMonths(fleet, s.id, today());
    if (!months.includes(reportMonth)) reportMonth = months.find((m) => siteChecks(fleet, s.id).some((c) => c.date.startsWith(m))) ?? months[0];
    const monthSel = h('select', {
      id: 'report-month',
      onchange: (e: Event) => {
        reportMonth = (e.target as HTMLSelectElement).value;
        render();
      },
    });
    for (const m of months) {
      const o = h('option', { value: m }, new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
      if (m === reportMonth) o.selected = true;
      monthSel.append(o);
    }
    const html = reportHtml(monthlyReport(fleet, s, reportMonth), s, fleet.agency);
    const frame = h('iframe', { class: 'report-frame', title: `Report preview for ${siteLabel(s)}` });
    frame.srcdoc = html;
    panel.append(
      h(
        'div',
        { class: 'toolbar' },
        h('label', { for: 'report-site' }, 'Site '),
        siteSelect('report-site', s.id, (v) => {
          siteId = v;
          render();
        }),
        h('label', { for: 'report-month' }, 'Month '),
        monthSel,
      ),
      fleet.agency.name.trim() ? '' : h('p', { class: 'warnbox' }, 'Reports carry your business name and color. ', h('button', { type: 'button', class: 'linkish', onclick: () => openTab('settings') }, 'Add your details'), ' first.'),
      h(
        'div',
        { class: 'toolbar' },
        h('button', { type: 'button', class: 'primary', onclick: () => printFn(frame) }, 'Print or save as PDF'),
        h('button', { type: 'button', onclick: () => download(`${slugify(siteLabel(s))}-accessibility-${reportMonth}.html`, html, 'text/html') }, 'Download as HTML'),
      ),
      frame,
    );
    return panel;
  }

  // ---------- Settings ----------

  function settingsPanel(): HTMLElement {
    const a = fleet.agency;
    const input = (k: 'name' | 'email' | 'website' | 'reportFooter', label: string, type = 'text', hint?: string) =>
      field(
        label,
        h('input', {
          id: `ag-${k}`,
          type,
          value: a[k],
          onchange: (e: Event) => {
            fleet = { ...fleet, agency: { ...fleet.agency, [k]: (e.target as HTMLInputElement).value } };
            persist();
          },
        }),
        hint,
      );
    const color = h('input', {
      id: 'ag-color',
      type: 'color',
      value: a.color,
      onchange: (e: Event) => {
        fleet = { ...fleet, agency: { ...fleet.agency, color: (e.target as HTMLInputElement).value } };
        persist();
      },
    });
    const open = h('input', {
      id: 'open-fleet',
      type: 'file',
      accept: '.json,application/json',
      onchange: async (e: Event) => {
        const fl = (e.target as HTMLInputElement).files?.[0];
        if (!fl) return;
        try {
          const f = parseFleet(await fl.text());
          if (fleet.sites.length > 0 && !confirmFn('Replace the fleet in this browser with the one in the file?')) return;
          setFleet(f, `Opened ${fl.name}: ${f.sites.length} site${f.sites.length === 1 ? '' : 's'}, ${f.checks.length} check${f.checks.length === 1 ? '' : 's'}.`);
        } catch (err) {
          say((err as Error).message);
        }
      },
    });
    return h(
      'div',
      {},
      h('h2', { tabindex: '-1' }, 'Your details and backup'),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'ag-h' },
        h('h3', { id: 'ag-h' }, 'Shown on client reports'),
        h('div', { class: 'grid2' }, input('name', 'Your business name'), input('email', 'Email', 'email'), input('website', 'Website'), field('Brand color', color, 'Darkened automatically if it is too light to read on white.')),
        input('reportFooter', 'Line at the end of every report', 'text', 'For example how clients reach you about the report.'),
        h('button', { type: 'button', onclick: () => say('Saved your details.') }, 'Save details'),
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'bk-h' },
        h('h3', { id: 'bk-h' }, 'Backup'),
        h('p', {}, 'Everything is kept in this browser only. Nothing is sent anywhere. Save a fleet file now and then, and open it on another computer to carry on there.'),
        saveFailed ? h('p', { class: 'warnbox' }, 'This browser is not saving your work (private window or storage full). Save a fleet file before you close the tab.') : null,
        h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', onclick: () => download(`fleet-${today()}.json`, serializeFleet(fleet), 'application/json') }, 'Save fleet file')),
        field('Open a fleet file', open),
        h(
          'p',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'danger',
              onclick: () => {
                if (!confirmFn('Delete every site, check and statement from this browser? Save a fleet file first if you may need them.')) return;
                setFleet(emptyFleet(), 'Cleared. The fleet is empty.');
              },
            },
            'Clear everything',
          ),
        ),
      ),
    );
  }

  // ---------- frame ----------

  function render(): void {
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    root.replaceChildren();
    const tablist = h('div', { role: 'tablist', class: 'tabs', 'aria-label': 'Sections' });
    for (const t of TABS) {
      const b = h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `tab-${t.id}`,
          'aria-selected': t.id === tab ? 'true' : 'false',
          'aria-controls': 'panel',
          tabindex: t.id === tab ? '0' : '-1',
          onclick: () => openTab(t.id),
          onkeydown: (e: Event) => {
            const k = (e as KeyboardEvent).key;
            const i = TABS.findIndex((x) => x.id === tab);
            const next = k === 'ArrowRight' ? (i + 1) % TABS.length : k === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : k === 'Home' ? 0 : k === 'End' ? TABS.length - 1 : -1;
            if (next < 0) return;
            e.preventDefault();
            openTab(TABS[next].id);
            root.querySelector<HTMLElement>(`#tab-${TABS[next].id}`)?.focus();
          },
        },
        t.label,
      );
      tablist.append(b);
    }
    const panels: Record<TabId, () => HTMLElement> = { fleet: fleetPanel, site: sitePanel, add: addPanel, reports: reportsPanel, settings: settingsPanel };
    root.append(
      h('a', { href: '#panel', class: 'skip' }, 'Skip to content'),
      h(
        'header',
        {},
        h('h1', {}, 'Accessibility Fleet Log'),
        h('p', { class: 'lede' }, 'Every client website you look after on one screen: a dated log of accessibility problems found and fixed, a draft statement per site, and a monthly report under your own name.'),
        h('p', { class: 'privacy' }, 'Runs in your browser. Nothing you add is uploaded.'),
      ),
      tablist,
      h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, message),
      h('main', { id: 'panel', role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, panels[tab]()),
    );
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && root.contains(el)) el.focus();
    }
  }

  render();
  return { fleet: () => fleet, setFleet, openTab };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
}
