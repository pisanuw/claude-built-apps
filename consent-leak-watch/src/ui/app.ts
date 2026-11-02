import type { Evidence, Finding, Mode, ScanReport } from '../core/analyze';
import { analyze, leakCount, modeLabel } from '../core/analyze';
import { describeAttribution, advice, verdict, toMarkdown, saveCheck, loadCheck, DISCLAIMER } from '../core/report';
import type { ScanDiff } from '../core/diff';
import { diffReports } from '../core/diff';
import { HarError, parseHar } from '../core/har';
import { sampleNoChoice, sampleRejected } from '../core/sample';
import { download, h } from './dom';

type Slot = Mode | 'previous';

interface State {
  reports: Partial<Record<Mode, ScanReport>>;
  previous: ScanReport[] | null;
  errors: Partial<Record<Slot, string>>;
  names: Partial<Record<Slot, string>>;
}

const SLOTS: Array<{ slot: Slot; title: string; hint: string; accept: string }> = [
  { slot: 'no-choice', title: 'Before choosing', hint: 'Recording 1 (.har): banner left alone', accept: '.har,.json,application/json' },
  { slot: 'rejected', title: 'After Reject all', hint: 'Recording 2 (.har): clicked Reject all, then browsed', accept: '.har,.json,application/json' },
  { slot: 'previous', title: 'Last check (optional)', hint: 'A check you saved before (.json), to see what changed', accept: '.json,application/json' },
];

export interface App {
  load(slot: Slot, text: string, name?: string): void;
  loadExample(): void;
  state: State;
}

export function mount(root: HTMLElement, now: () => Date = () => new Date()): App {
  const state: State = { reports: {}, previous: null, errors: {}, names: {} };
  const results = h('section', { class: 'results', 'aria-live': 'polite' });
  const zones = h('div', { class: 'zones' });

  function load(slot: Slot, text: string, name = 'file'): void {
    delete state.errors[slot];
    state.names[slot] = name;
    try {
      if (slot === 'previous') state.previous = loadCheck(text).reports;
      else state.reports[slot] = analyze(parseHar(text), slot, now());
    } catch (e) {
      state.errors[slot] = e instanceof HarError || e instanceof Error ? e.message : String(e);
      if (slot === 'previous') state.previous = null;
      else delete state.reports[slot];
    }
    render();
  }

  function loadExample(): void {
    const old = [analyze(parseHar(sampleNoChoice(false)), 'no-choice', new Date('2026-10-05T09:00:00Z')), analyze(parseHar(sampleRejected(false)), 'rejected', new Date('2026-10-05T09:00:00Z'))];
    load('previous', saveCheck(old, new Date('2026-10-05T09:00:00Z')), 'example: last month');
    load('no-choice', sampleNoChoice(true), 'example: before choosing');
    load('rejected', sampleRejected(true), 'example: after Reject all');
  }

  function zone(spec: (typeof SLOTS)[number]): HTMLElement {
    const input = h('input', { type: 'file', accept: spec.accept, id: `file-${spec.slot}`, class: 'visually-hidden' });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void f.text().then((t) => load(spec.slot, t, f.name));
    });
    const box = h(
      'label',
      { class: 'zone', for: `file-${spec.slot}`, 'data-slot': spec.slot },
      h('strong', {}, spec.title),
      h('span', { class: 'hint' }, spec.hint),
      h('span', { class: 'status' }),
      input,
    );
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      box.classList.add('over');
    });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('over');
      const f = (e as DragEvent).dataTransfer?.files[0];
      if (f) void f.text().then((t) => load(spec.slot, t, f.name));
    });
    return box;
  }

  function renderZones(): void {
    for (const el of zones.querySelectorAll<HTMLElement>('.zone')) {
      const slot = el.dataset.slot as Slot;
      const status = el.querySelector('.status') as HTMLElement;
      const err = state.errors[slot];
      const loaded = slot === 'previous' ? state.previous : state.reports[slot as Mode];
      el.classList.toggle('error', Boolean(err));
      el.classList.toggle('loaded', Boolean(loaded));
      status.textContent = err ?? (loaded ? `Loaded: ${state.names[slot]}` : 'Drop a file here or click to choose');
    }
  }

  function render(): void {
    renderZones();
    results.replaceChildren();
    const reports = (['no-choice', 'rejected'] as Mode[]).map((m) => state.reports[m]).filter((r): r is ScanReport => Boolean(r));
    if (reports.length === 0) return;

    const diffs: ScanDiff[] = [];
    for (const r of reports) {
      const prev = state.previous?.find((p) => p.mode === r.mode);
      if (prev) diffs.push(diffReports(prev, r));
    }
    const sites = new Set(reports.map((r) => r.site));
    results.append(h(
      'div',
      {},
      h('h2', {}, `Results for ${[...sites].join(' and ')}`),
      sites.size > 1 ? h('p', { class: 'warn' }, 'The two recordings are from different sites. Check that you dropped the right files.') : null,
      summaryBar(reports),
      diffs.length ? diffView(diffs) : null,
      ...reports.map(reportView),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', onclick: () => download(`consent-check-${reports[0].site}-${now().toISOString().slice(0, 10)}.json`, saveCheck(reports, now()), 'application/json') }, 'Save this check for next time'),
        h('button', { type: 'button', class: 'secondary', onclick: () => download(`consent-check-${reports[0].site}.md`, toMarkdown(reports, diffs), 'text/markdown') }, 'Download summary (Markdown)'),
      ),
      h('p', { class: 'fine' }, DISCLAIMER),
    ));
  }

  root.replaceChildren(
    h(
      'header',
      {},
      h('h1', {}, 'Consent Leak Watch'),
      h('p', { class: 'lede' }, 'Does your cookie banner actually stop the trackers? Record two short visits to your shop, drop them here, and see which cookies and trackers fire before a visitor agrees, which plugin loaded them, and what changed since your last check.'),
      h('p', { class: 'privacy' }, 'Everything runs in this browser tab. Your recordings never leave your computer.'),
    ),
    h('main', {}, howTo(), h('section', {}, h('h2', {}, '2. Drop your recordings'), zones, h('p', {}, h('button', { type: 'button', class: 'secondary', id: 'example', onclick: loadExample }, 'Try the example shop'), ' ', h('span', { class: 'hint' }, 'A made-up candle shop whose Meta plugin update started tracking before consent.'))), results),
  );
  zones.append(...SLOTS.map(zone));
  renderZones();
  return { load, loadExample, state };
}

function howTo(): HTMLElement {
  return h(
    'section',
    {},
    h('h2', {}, '1. Record two visits (about five minutes)'),
    h(
      'details',
      { open: true },
      h('summary', {}, 'Step by step, in Chrome or Edge'),
      h(
        'ol',
        {},
        h('li', {}, 'Open a new private (Incognito) window, so no old cookies get in the way.'),
        h('li', {}, 'Press F12 (Mac: Cmd+Option+I) and open the Network tab. Tick “Preserve log”.'),
        h('li', {}, 'One time only: click the gear in DevTools, and under Network tick “Allow to generate HAR with sensitive data”. Without it Chrome leaves the cookies out.'),
        h('li', {}, h('strong', {}, 'Recording 1: '), 'type your shop address and load it. Do not touch the cookie banner. Open a product page and one other page. Then right-click the request list and choose “Save all as HAR (with sensitive data)” (older Chrome: “Save all as HAR with content”).'),
        h('li', {}, h('strong', {}, 'Recording 2: '), 'close the window, open a fresh private window and DevTools again, load your shop, click ', h('em', {}, 'Reject all'), ' (or Deny), then open a product page and one other page. Save as HAR again.'),
        h('li', {}, 'Drop both files below. Firefox works too (Network tab, gear, “Save All As HAR”), but it does not record which script made each request, so fewer leaks can be traced to a plugin.'),
      ),
      h('p', { class: 'hint' }, 'A HAR file contains everything the browser sent and received, so treat it like a password for any account you were logged into. A fresh private window keeps it clean, and this page never uploads it.'),
    ),
  );
}

function summaryBar(reports: ScanReport[]): HTMLElement {
  return h(
    'div',
    { class: 'summary' },
    ...reports.map((r) => {
      const n = leakCount(r);
      return h('div', { class: `tile ${n ? 'bad' : 'good'}` }, h('span', { class: 'big' }, String(n)), h('span', {}, `tracker${n === 1 ? '' : 's'} ${modeLabel(r.mode)}`));
    }),
  );
}

const CHOICE: Record<string, string> = { none: 'no choice yet', rejected: 'rejected', accepted: 'accepted', custom: 'custom', unknown: 'could not read' };
const PURPOSE: Record<string, string> = { marketing: 'Advertising', analytics: 'Analytics', embed: 'Third-party embed', notice: 'Worth knowing', necessary: 'Necessary' };
const SETBY: Record<string, string> = { server: 'set by your server', script: 'set by a script on the page', 'third-party': 'set by the third party' };

function evidenceItem(e: Evidence): HTMLElement {
  const label = e.type === 'cookie' ? h('span', {}, 'Cookie ', h('code', {}, e.name), ` (${SETBY[e.setBy ?? 'script']})`) : h('span', {}, 'Request to ', h('code', { class: 'url' }, e.name));
  return h(
    'li',
    {},
    label,
    h('span', { class: 'meta' }, ` · ${e.phase === 'before-choice' ? 'before any choice' : 'after Reject all'} · ${e.count}×`),
    e.note ? h('div', { class: 'note' }, e.note) : null,
  );
}

function findingCard(f: Finding): HTMLElement {
  return h(
    'article',
    { class: `finding ${f.severity}` },
    h('h4', {}, h('span', { class: `badge ${f.severity}` }, f.severity === 'leak' ? 'Leak' : 'Note'), ' ', f.vendor, h('span', { class: 'purpose' }, ` ${PURPOSE[f.purpose]}`)),
    h('p', { class: 'what' }, f.what),
    h('ul', { class: 'evidence' }, ...f.evidence.map(evidenceItem)),
    h('p', { class: 'source' }, h('strong', {}, 'Where it comes from: '), f.attributions.map(describeAttribution).join(' ')),
    h('p', { class: 'next' }, h('strong', {}, 'Next step: '), advice(f)),
  );
}

function reportView(r: ScanReport): HTMLElement {
  const leaks = r.findings.filter((f) => f.severity === 'leak');
  const notes = r.findings.filter((f) => f.severity === 'notice');
  return h(
    'section',
    { class: 'report', 'data-mode': r.mode },
    h('h3', {}, `Recording ${r.mode === 'no-choice' ? '1' : '2'}: ${modeLabel(r.mode)}`),
    h('p', { class: `verdict ${leaks.length ? 'bad' : 'good'}` }, verdict(r)),
    h('p', { class: 'meta' }, `${r.requestCount} requests across ${r.pages.length} page(s). Banner: ${r.cmp.name ? `${r.cmp.name} (stored choice: ${CHOICE[r.cmp.choice]})` : 'not recognised'}.`),
    ...r.warnings.map((w) => h('p', { class: 'warn' }, w)),
    ...leaks.map(findingCard),
    notes.length ? h('details', {}, h('summary', {}, `${notes.length} thing(s) worth knowing that are not leaks`), ...notes.map(findingCard)) : null,
    r.unclassifiedCookies.length
      ? h('p', { class: 'meta' }, 'Your site also set cookies this tool does not recognise: ', ...r.unclassifiedCookies.flatMap((c, i) => [i ? ', ' : '', h('code', {}, c)]), '. They may be harmless; check them in your banner’s cookie list.')
      : null,
    r.plugins.length
      ? h(
          'details',
          {},
          h('summary', {}, `${r.plugins.length} plugin(s) and theme(s) seen in this recording`),
          h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Folder'), h('th', {}, 'Version'))), h('tbody', {}, ...r.plugins.map((p) => h('tr', {}, h('td', {}, p.label), h('td', {}, h('code', {}, p.slug)), h('td', {}, p.versions.join(', ') || 'not shown'))))),
          h('p', { class: 'hint' }, 'Speed plugins that combine files hide some plugins from this list.'),
        )
      : null,
  );
}

function diffView(diffs: ScanDiff[]): HTMLElement {
  const box = h('section', { class: 'diff' }, h('h3', {}, 'Since your last check'));
  for (const d of diffs) {
    const items: HTMLElement[] = [];
    if (!d.sameSite) items.push(h('p', { class: 'warn' }, 'Your last check was for a different site, so this comparison may not mean much.'));
    for (const s of d.suspects) {
      items.push(h('p', { class: 'suspect' }, h('strong', {}, 'Likely cause: '), `${s.label} updated from ${s.before.join('/') || 'not present'} to ${s.after.join('/') || 'unknown'}, and it is the source named on the new ${s.vendor} leak.`));
    }
    items.push(
      h('p', {}, h('strong', {}, 'New leaks: '), d.newLeaks.map((f) => f.vendor).join(', ') || 'none'),
      h('p', {}, h('strong', {}, 'Fixed: '), d.fixedLeaks.map((f) => f.vendor).join(', ') || 'none'),
    );
    for (const n of d.newEvidence) items.push(h('p', {}, h('strong', {}, `${n.vendor}, new: `), n.names.join(', ')));
    if (d.pluginChanges.length) {
      items.push(h('ul', { class: 'changes' }, ...d.pluginChanges.map((c) => h('li', {}, `${c.label}: ${c.change === 'updated' ? `${c.before.join('/') || '?'} → ${c.after.join('/') || '?'}` : c.change}`))));
    }
    const title = modeLabel(d.mode);
    box.append(h('div', { class: 'diff-part' }, h('h4', {}, title[0].toUpperCase() + title.slice(1)), ...items));
  }
  return box;
}
