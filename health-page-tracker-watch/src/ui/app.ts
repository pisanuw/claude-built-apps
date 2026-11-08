import type { Level, Practice, Profile, Report, StateLaw, ToolFinding } from '../core/analyze';
import { BASIC_RECEIVES, LEVEL_LABEL, analyze, context, verdict } from '../core/analyze';
import type { Capture } from '../core/capture';
import { InputError, mergeCaptures, parseHar, parsePageSource } from '../core/capture';
import type { CheckDiff, SavedCheck } from '../core/check';
import { diffChecks, hasChanges, loadCheck, saveCheck, tableUpdatesSince } from '../core/check';
import { DISCLAIMER, reminderIcs, toMarkdown } from '../core/export';
import type { PageKind } from '../core/pages';
import { PAGE_KINDS, kindLabel } from '../core/pages';
import { sampleHar } from '../core/sample';
import { BAA_LABEL, KINDS, TABLE_REVIEWED, vendorList } from '../core/vendors';
import { download, h } from './dom';

export const APP_URL = 'https://health-page-tracker-watch.hintwise.org';

interface Input {
  id: number;
  label: string;
  capture: Capture;
}

interface State {
  inputs: Input[];
  previous: SavedCheck | null;
  previousName: string;
  profile: Profile;
  overrides: Record<string, PageKind>;
  error: string;
  report: Report | null;
}

export interface App {
  addRecording(text: string, name?: string): void;
  addPageSource(url: string, html: string): void;
  loadPrevious(text: string, name?: string): void;
  loadExample(): void;
  setKind(url: string, kind: PageKind): void;
  setProfile(p: Partial<Profile>): void;
  remove(id: number): void;
  state: State;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function message(e: unknown): string {
  return e instanceof InputError || e instanceof Error ? e.message : String(e);
}

export function mount(root: HTMLElement, now: () => Date = () => new Date()): App {
  const state: State = { inputs: [], previous: null, previousName: '', profile: { practice: 'unsure', states: [] }, overrides: {}, error: '', report: null };
  let nextId = 1;
  const inputList = h('ul', { class: 'inputs', 'aria-label': 'Pages added' });
  const errorBox = h('p', { class: 'error', role: 'alert' });
  const prevStatus = h('span', { class: 'status' });
  const results = h('section', { class: 'results', 'aria-live': 'polite' });

  function addCapture(c: Capture, label: string): void {
    const site = state.inputs[0]?.capture.site;
    if (site && site !== c.site) {
      state.error = `That is a different site (${c.site}) from the one already added (${site}). Check one site at a time.`;
    } else {
      state.inputs.push({ id: nextId++, label, capture: c });
      state.error = '';
    }
  }

  function addRecording(text: string, name = 'recording'): void {
    try {
      addCapture(parseHar(text), name);
    } catch (e) {
      state.error = message(e);
    }
    render();
  }

  function addPageSource(url: string, html: string): void {
    try {
      const c = parsePageSource(url, html);
      addCapture(c, `Page source: ${pathOf(c.pages[0].url)}`);
    } catch (e) {
      state.error = message(e);
    }
    render();
  }

  function loadPrevious(text: string, name = 'saved check'): void {
    try {
      state.previous = loadCheck(text);
      state.previousName = name;
      state.error = '';
      for (const p of state.previous.pages) if (!(p.url in state.overrides)) state.overrides[p.url] = p.kind;
    } catch (e) {
      state.previous = null;
      state.error = message(e);
    }
    render();
  }

  function loadExample(): void {
    state.inputs = [];
    state.overrides = {};
    state.profile = { practice: 'hipaa', states: ['WA'] };
    const last = analyze(parseHar(sampleHar(false)), state.profile, {}, new Date('2026-10-06T16:30:00Z'));
    state.previous = loadCheck(saveCheck(last));
    state.previousName = 'example: last month’s check';
    addCapture(parseHar(sampleHar(true)), 'example: Harborview Counseling, this month');
    syncProfileInputs();
    render();
  }

  function setKind(url: string, kind: PageKind): void {
    state.overrides[url] = kind;
    render();
  }

  function setProfile(p: Partial<Profile>): void {
    state.profile = { ...state.profile, ...p };
    render();
  }

  function remove(id: number): void {
    state.inputs = state.inputs.filter((i) => i.id !== id);
    render();
  }

  // --- practice questions ---------------------------------------------------
  const practiceRadios = (
    [
      ['hipaa', 'A healthcare provider covered by HIPAA', 'For example a therapist, dentist or clinic that bills health insurance.'],
      ['wellness', 'A wellness business not covered by HIPAA', 'For example a cash-only med spa, yoga or massage studio, or coach.'],
      ['unsure', 'Not sure', 'The report covers both.'],
    ] as Array<[Practice, string, string]>
  ).map(([value, label, hint]) => {
    const input = h('input', { type: 'radio', name: 'practice', value });
    input.addEventListener('change', () => setProfile({ practice: value }));
    return h('label', { class: 'choice' }, input, h('span', {}, h('strong', {}, label), h('span', { class: 'hint' }, ` ${hint}`)));
  });
  const stateBoxes = (
    [
      ['WA', 'Washington'],
      ['NV', 'Nevada'],
      ['CT', 'Connecticut'],
    ] as Array<[StateLaw, string]>
  ).map(([value, label]) => {
    const input = h('input', { type: 'checkbox', name: 'state', value });
    input.addEventListener('change', () => {
      const set = new Set(state.profile.states);
      if (input.checked) set.add(value);
      else set.delete(value);
      setProfile({ states: (['WA', 'NV', 'CT'] as StateLaw[]).filter((s) => set.has(s)) });
    });
    return h('label', { class: 'check' }, input, ` ${label}`);
  });
  function syncProfileInputs(): void {
    for (const l of practiceRadios) {
      const i = l.querySelector('input') as HTMLInputElement;
      i.checked = i.value === state.profile.practice;
    }
    for (const l of stateBoxes) {
      const i = l.querySelector('input') as HTMLInputElement;
      i.checked = state.profile.states.includes(i.value as StateLaw);
    }
  }

  // --- inputs ------------------------------------------------------------------
  const harInput = h('input', { type: 'file', accept: '.har,.json,application/json', multiple: true, id: 'file-har', class: 'visually-hidden' });
  async function readFiles(files: FileList | null | undefined, into: (text: string, name: string) => void): Promise<void> {
    for (const f of Array.from(files ?? [])) into(await f.text(), f.name);
  }
  harInput.addEventListener('change', () => void readFiles(harInput.files, addRecording));
  const harZone = dropZone('file-har', 'Drop recordings here', 'One or more .har files, or click to choose', harInput, (files) => void readFiles(files, addRecording));

  const prevInput = h('input', { type: 'file', accept: '.json,application/json', id: 'file-prev', class: 'visually-hidden' });
  prevInput.addEventListener('change', () => void readFiles(prevInput.files, loadPrevious));
  const prevZone = dropZone('file-prev', 'Last check (optional)', 'The .json file you saved last time, to see what changed', prevInput, (files) => void readFiles(files, loadPrevious));
  prevZone.append(prevStatus);

  const srcUrl = h('input', { type: 'url', id: 'src-url', placeholder: 'https://yourpractice.com/book', autocomplete: 'off' });
  const srcText = h('textarea', { id: 'src-html', rows: '5', placeholder: 'Paste the page source here' });
  const srcForm = h(
    'form',
    { class: 'source-form' },
    h('label', { for: 'src-url' }, 'Page address'),
    srcUrl,
    h('label', { for: 'src-html' }, 'Page source'),
    srcText,
    h('button', { type: 'submit', class: 'secondary' }, 'Add this page'),
  );
  srcForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addPageSource(srcUrl.value.trim(), srcText.value);
    if (!state.error) {
      srcUrl.value = '';
      srcText.value = '';
    }
  });

  function renderInputs(): void {
    inputList.replaceChildren(
      ...state.inputs.map((i) =>
        h(
          'li',
          {},
          h('span', {}, h('strong', {}, i.label), ` · ${i.capture.pages.length} page${i.capture.pages.length === 1 ? '' : 's'} of ${i.capture.site}`),
          h('button', { type: 'button', class: 'link', 'aria-label': `Remove ${i.label}`, onclick: () => remove(i.id) }, 'Remove'),
        ),
      ),
    );
    errorBox.textContent = state.error;
    errorBox.hidden = !state.error;
    prevZone.classList.toggle('loaded', Boolean(state.previous));
    prevStatus.textContent = state.previous ? `Loaded: ${state.previousName} (${state.previous.site}, ${state.previous.savedAt.slice(0, 10)})` : '';
  }

  function render(): void {
    renderInputs();
    results.replaceChildren();
    state.report = null;
    if (state.inputs.length === 0) return;
    const capture = mergeCaptures(state.inputs.map((i) => i.capture));
    const report = analyze(capture, state.profile, state.overrides, now());
    state.report = report;
    const diff = state.previous ? diffChecks(state.previous, report) : null;
    results.append(reportView(report, diff, state.previous, setKind, now));
  }

  root.replaceChildren(
    h(
      'header',
      {},
      h('h1', {}, 'Health Page Tracker Watch'),
      h('p', { class: 'lede' }, 'Which outside tools on your booking, intake and service pages send visitor information to other companies? See every one, what it receives, whether its maker signs a Business Associate Agreement (BAA), and what is new since last month.'),
      h('p', { class: 'privacy' }, 'Everything runs in this browser tab. Nothing you add here is uploaded.'),
    ),
    h(
      'main',
      {},
      h('section', {}, h('h2', {}, '1. About your practice'), h('fieldset', {}, h('legend', {}, 'Which describes you best?'), ...practiceRadios), h('fieldset', {}, h('legend', {}, 'Do you serve people in any of these states? They have consumer health data laws.'), h('div', { class: 'states' }, ...stateBoxes))),
      h(
        'section',
        {},
        h('h2', {}, '2. Add your pages'),
        h('p', {}, 'Include your booking page, your intake or new-client forms page, and a few service or condition pages. Those are the pages that matter most.'),
        h('div', { class: 'ways' }, h('div', { class: 'way' }, h('h3', {}, 'Record them in your browser'), h('p', { class: 'hint' }, 'Finds the most: it sees tools that other tools load.'), howTo(), harZone), h('div', { class: 'way' }, h('h3', {}, 'Or paste a page’s source'), h('p', { class: 'hint' }, 'Quicker, but it misses tools loaded later (for example through Google Tag Manager). Open the page, press Ctrl+U (Mac: Cmd+Option+U), select all, copy.'), srcForm)),
        errorBox,
        inputList,
        h('h3', {}, 'Comparing with last month'),
        prevZone,
        h('p', {}, h('button', { type: 'button', class: 'secondary', id: 'example', onclick: loadExample }, 'Try the example practice'), ' ', h('span', { class: 'hint' }, 'A made-up counseling practice where an update put the Meta Pixel on the booking page.')),
      ),
      results,
      vendorTableView(),
    ),
  );
  syncProfileInputs();
  renderInputs();
  // Closed <details> do not print their contents, so open them for printing.
  let reopen: HTMLDetailsElement[] = [];
  window.addEventListener('beforeprint', () => {
    reopen = [...results.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
    for (const d of reopen) d.open = true;
  });
  window.addEventListener('afterprint', () => {
    for (const d of reopen) d.open = false;
    reopen = [];
  });
  return { addRecording, addPageSource, loadPrevious, loadExample, setKind, setProfile, remove, state };
}

function dropZone(forId: string, title: string, hint: string, input: HTMLInputElement, onFiles: (f: FileList | undefined) => void): HTMLElement {
  const box = h('label', { class: 'zone', for: forId }, h('strong', {}, title), h('span', { class: 'hint' }, hint), input);
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('over');
  });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('over');
    onFiles((e as DragEvent).dataTransfer?.files);
  });
  return box;
}

function howTo(): HTMLElement {
  return h(
    'details',
    {},
    h('summary', {}, 'How to record (Chrome or Edge, about five minutes)'),
    h(
      'ol',
      {},
      h('li', {}, 'Open a private (Incognito) window, so you are not logged in to anything.'),
      h('li', {}, 'Press F12 (Mac: Cmd+Option+I) and open the Network tab. Tick “Preserve log”.'),
      h('li', {}, 'Type your website’s address and load it. Then open your booking page, your intake forms page and two or three service pages, waiting a few seconds on each.'),
      h('li', {}, 'Right-click the list of requests and choose “Save all as HAR”. Drop the file below.'),
    ),
    h('p', { class: 'hint' }, 'Firefox works too: Network tab, gear icon, “Save All As HAR”. Do not fill in or submit any real forms while recording.'),
  );
}

const LEVEL_INTRO: Record<Level, string> = {
  review: 'Tools that see what visitors do or type, running on your health pages, whose makers do not sign a BAA (or we could not confirm one).',
  check: 'Things on your health pages worth a quick confirmation.',
  fyi: 'Seen only on pages that are not booking, intake or service pages.',
  ok: 'Tools whose makers sign a BAA.',
};

function toolCard(t: ToolFinding): HTMLElement {
  return h(
    'article',
    { class: `tool ${t.level}`, 'data-key': t.key },
    h('h4', {}, h('span', { class: `badge ${t.level}` }, LEVEL_LABEL[t.level]), ' ', t.name, h('span', { class: 'kind' }, ` ${t.kind ? KINDS[t.kind].label : 'Unknown company'}`)),
    h('ul', { class: 'why' }, ...t.why.map((w) => h('li', {}, w))),
    h('p', {}, h('strong', {}, 'BAA: '), t.baa ? `${BAA_LABEL[t.baa]}. ` : '', t.baaNote),
    h('p', {}, h('strong', {}, 'What it receives: '), t.receives),
    h('p', { class: 'pages-line' }, h('strong', {}, 'Pages: '), ...t.pages.flatMap((p, i) => [i ? ', ' : '', h('code', {}, pathOf(p.url)), p.health ? ' (health page)' : ''])),
    h('p', {}, h('strong', {}, 'Options for your web person: '), t.options),
    h('p', { class: 'meta' }, `Addresses contacted: ${t.hosts.join(', ')}`),
  );
}

function diffView(d: CheckDiff, prev: SavedCheck): HTMLElement {
  const box = h('section', { class: 'diff' }, h('h3', {}, `Since your check of ${d.previousDate}`));
  if (!d.sameSite) box.append(h('p', { class: 'warn' }, 'Your last check was for a different site, so this comparison may not mean much.'));
  if (!hasChanges(d)) box.append(h('p', { class: 'good-line' }, 'No change in the outside tools on the pages you checked.'));
  const list = (label: string, items: string[]): HTMLElement | null => (items.length ? h('p', {}, h('strong', {}, label), items.join('; ')) : null);
  box.append(
    ...[
      list('New: ', d.newTools.map((t) => `${t.name}${t.healthPages.length ? ` (on ${t.healthPages.map(pathOf).join(', ')})` : ''}`)),
      list('Now on more health pages: ', d.spread.map((t) => `${t.name} (${t.newHealthPages.map(pathOf).join(', ')})`)),
      list('More urgent than before: ', d.worse.map((t) => `${t.name} (${LEVEL_LABEL[t.before]} → ${LEVEL_LABEL[t.after]})`)),
      list('Gone: ', d.goneTools.map((t) => t.name)),
      list('Vendor BAA position changed in our table: ', tableUpdatesSince(prev).map((t) => `${t.name} (${t.before ? BAA_LABEL[t.before] : '?'} → ${BAA_LABEL[t.after]})`)),
      d.notRechecked.length ? h('p', { class: 'meta' }, `Not checked this time: ${d.notRechecked.map(pathOf).join(', ')}. Record them too for a full comparison.`) : null,
    ].filter((x): x is HTMLElement => x !== null),
  );
  return box;
}

function reportView(r: Report, diff: CheckDiff | null, prev: SavedCheck | null, setKind: (url: string, kind: PageKind) => void, now: () => Date): HTMLElement {
  const group = (level: Level) => r.tools.filter((t) => t.level === level);
  const section = (level: Level, open: boolean) => {
    const list = group(level);
    if (!list.length) return null;
    const inner = [h('p', { class: 'hint' }, LEVEL_INTRO[level]), ...list.map(toolCard)];
    return open ? h('div', { class: 'group', 'data-level': level }, h('h3', {}, `${LEVEL_LABEL[level]} (${list.length})`), ...inner) : h('details', { class: 'group', 'data-level': level }, h('summary', {}, `${LEVEL_LABEL[level]} (${list.length})`), ...inner);
  };
  const date = r.generatedAt.slice(0, 10);
  return h(
    'div',
    { class: 'report' },
    h('h2', {}, `3. Results for ${r.site}`),
    h('p', { class: 'meta' }, `Checked ${date}. Vendor table reviewed ${r.tableReviewed}.`),
    h('p', { class: `verdict ${r.counts.review ? 'bad' : r.counts.check ? 'mid' : 'good'}` }, verdict(r)),
    h(
      'div',
      { class: 'summary' },
      tile('review', r.counts.review, 'to review now'),
      tile('check', r.counts.check, 'to confirm'),
      tile('pages', r.pages.length, `pages checked, ${r.healthPageCount} health page${r.healthPageCount === 1 ? '' : 's'}`),
    ),
    h('p', { class: 'context' }, context(r.profile)),
    ...r.warnings.map((w) => h('p', { class: 'warn' }, w)),
    diff && prev ? diffView(diff, prev) : null,
    section('review', true),
    section('check', true),
    section('fyi', false),
    section('ok', false),
    h('p', { class: 'hint' }, BASIC_RECEIVES),
    pagesTable(r, setKind),
    h(
      'div',
      { class: 'actions no-print' },
      h('button', { type: 'button', onclick: () => download(`health-page-check-${r.site}-${date}.json`, saveCheck(r), 'application/json') }, 'Save this check for next month'),
      h('button', { type: 'button', class: 'secondary', onclick: () => download(`health-page-check-${r.site}-${date}.md`, toMarkdown(r, diff), 'text/markdown') }, 'Download summary for your web person'),
      h('button', { type: 'button', class: 'secondary', onclick: () => window.print() }, 'Print or save as PDF'),
      h('button', { type: 'button', class: 'secondary', onclick: () => download('health-page-check-reminder.ics', reminderIcs(r.site, APP_URL, now()), 'text/calendar') }, 'Add a monthly reminder'),
    ),
    h('p', { class: 'fine' }, DISCLAIMER),
  );
}

function tile(cls: string, n: number, label: string): HTMLElement {
  return h('div', { class: `tile ${cls} ${n ? '' : 'zero'}` }, h('span', { class: 'big' }, String(n)), h('span', {}, label));
}

function pagesTable(r: Report, setKind: (url: string, kind: PageKind) => void): HTMLElement {
  return h(
    'details',
    { class: 'pages', open: true },
    h('summary', {}, `Pages checked (${r.pages.length})`),
    h('p', { class: 'hint' }, 'We guessed each page’s kind from its address. Change it if we got it wrong; the report updates.'),
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Page'), h('th', {}, 'Kind'), h('th', {}, 'Outside tools'), h('th', {}, 'Read from'))),
      h(
        'tbody',
        {},
        ...r.pages.map((p) => {
          const sel = h('select', { 'aria-label': `Kind of page ${pathOf(p.url)}` }, ...PAGE_KINDS.map((k) => h('option', { value: k.kind, ...(k.kind === p.kind ? { selected: true } : {}) }, k.label)));
          sel.addEventListener('change', () => setKind(p.url, sel.value as PageKind));
          return h('tr', { class: p.health ? 'health' : '' }, h('td', {}, h('code', {}, pathOf(p.url))), h('td', {}, sel), h('td', {}, String(p.tools.length)), h('td', {}, p.source === 'recording' ? 'Recording' : 'Page source'));
        }),
      ),
    ),
    h('p', { class: 'meta print-only' }, r.pages.map((p) => `${pathOf(p.url)}: ${kindLabel(p.kind)}`).join(' · ')),
  );
}

function vendorTableView(): HTMLElement {
  const search = h('input', { type: 'search', placeholder: 'Search, e.g. chat or Jane', 'aria-label': 'Search the vendor table' });
  const rows = vendorList().map((v) =>
    h('tr', { 'data-text': `${v.name} ${v.company} ${KINDS[v.kind].label}`.toLowerCase() }, h('td', {}, v.name), h('td', {}, KINDS[v.kind].label), h('td', {}, h('span', { class: `baa ${v.baa}` }, BAA_LABEL[v.baa])), h('td', {}, v.baaNote)),
  );
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const r of rows) r.hidden = Boolean(q) && !(r.dataset.text ?? '').includes(q);
  });
  return h(
    'section',
    { class: 'vendors no-print' },
    h('h2', {}, 'The vendor table'),
    h('details', {}, h('summary', {}, `${rows.length} tools we recognise, reviewed ${TABLE_REVIEWED}`), h('p', { class: 'hint' }, '“Ask the vendor” means we have not confirmed what the vendor offers. A BAA covers only the products and plans it names, so keep the signed copy.'), search, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Tool'), h('th', {}, 'Kind'), h('th', {}, 'BAA'), h('th', {}, 'What the vendor says'))), h('tbody', {}, ...rows))),
  );
}
