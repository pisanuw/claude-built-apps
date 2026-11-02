import { cliCommand, consoleSnippet, countScan, parseAxeText } from '../core/axe';
import { evaluate, evaluateCriterion, type CriterionResult, type Conformance } from '../core/conformance';
import { diffProjects, type ProjectDiff } from '../core/diff';
import {
  answerFor,
  emptyProject,
  newId,
  parseProject,
  projectFileName,
  serializeProject,
  type Outcome,
  type Product,
  type Project,
  type Scan,
  type Screen,
} from '../core/project';
import { buildReport, reportHtml } from '../core/report';
import { samplePrevious, sampleProject } from '../core/sample';
import { CRITERIA, GATES, PRINCIPLES, type Criterion } from '../core/wcag';
import { download, downloadBlob, h } from './dom';

export type TabId = 'product' | 'screens' | 'review' | 'report' | 'compare';

const TABS: { id: TabId; label: string }[] = [
  { id: 'product', label: '1. Product' },
  { id: 'screens', label: '2. Screens and scans' },
  { id: 'review', label: '3. Guided review' },
  { id: 'report', label: '4. Report' },
  { id: 'compare', label: '5. Compare releases' },
];

const STORAGE_KEY = 'acr-draft:project';

export interface MountOptions {
  now?: () => Date;
  /** Pass null to disable saving in the browser. */
  storage?: Storage | null;
  /** Runs an in-browser scan of pasted HTML. Injected so tests do not need a layout engine. */
  scanHtml?: (html: string, url: string) => Promise<{ scan: Scan; removedScripts: number; unstyled: boolean }>;
  /** Builds the Word file. Injected in tests; lazy-loads the docx library otherwise. */
  makeDocx?: (p: Project) => Promise<Blob>;
}

export interface App {
  project(): Project;
  setProject(p: Project, message?: string): void;
  openTab(id: TabId): void;
  importAxe(screenId: string, text: string): string;
  importCli(text: string): string;
  compareWith(previous: Project): ProjectDiff;
}

const OUTCOME_LABELS: [Outcome, string][] = [
  ['pass', 'Passes'],
  ['partial', 'Partly'],
  ['fail', 'Fails'],
  ['na', "Doesn't apply"],
  ['untested', 'Not tested yet'],
];

const LEVEL_CLASS: Record<Conformance, string> = {
  Supports: 'lv-supports',
  'Partially Supports': 'lv-partial',
  'Does Not Support': 'lv-fails',
  'Not Applicable': 'lv-na',
  'Not Evaluated': 'lv-none',
};

function levelBadge(level: Conformance): HTMLElement {
  return h('span', { class: `level ${LEVEL_CLASS[level]}` }, level);
}

function safeStorage(s: Storage | null | undefined): Storage | null {
  if (s === null) return null;
  try {
    return s ?? window.localStorage;
  } catch {
    return null;
  }
}

async function defaultDocx(p: Project): Promise<Blob> {
  const { reportDocxBlob } = await import('../core/docx');
  return reportDocxBlob(buildReport(p, evaluate(p)));
}

async function defaultScan(html: string, url: string) {
  const { scanHtmlInFrame } = await import('./frame');
  return scanHtmlInFrame(html, url);
}

export function mount(root: HTMLElement, opts: MountOptions = {}): App {
  const now = opts.now ?? (() => new Date());
  const storage = safeStorage(opts.storage);
  const scanHtml = opts.scanHtml ?? defaultScan;
  const makeDocx = opts.makeDocx ?? defaultDocx;
  const today = () => now().toISOString().slice(0, 10);

  let project: Project = emptyProject(today());
  let tab: TabId = 'product';
  let previous: Project | null = null;
  let reviewFilter: 'all' | 'attention' | 'untested' | 'failures' = 'all';

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, serializeProject(project, now()));
    } catch {
      /* storage full or blocked: the project file download still works */
    }
  }

  // ---------- skeleton ----------
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const tablist = h('div', { role: 'tablist', 'aria-label': 'Steps', class: 'tabs' });
  const panel = h('div', { role: 'tabpanel', id: 'panel', tabindex: '-1', class: 'panel' });
  const openInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'open-file', tabindex: '-1', 'aria-label': 'Saved project file' });

  root.replaceChildren(
    h('a', { href: '#panel', class: 'skip' }, 'Skip to the current step'),
    h(
      'header',
      {},
      h('h1', {}, 'ACR Draft'),
      h('p', { class: 'lede' }, 'An honest accessibility conformance report (ACR, the filled-in VPAT®) for your web product: automated scans plus a guided manual review, exported to Word.'),
      h('p', { class: 'privacy' }, 'Everything stays in this browser tab. Nothing you enter is uploaded.'),
      h(
        'div',
        { class: 'actions top' },
        h('button', { type: 'button', id: 'example', onclick: () => setProject(sampleProject(), 'Loaded the example: QuizNest 4.2, a made-up quiz platform, partly reviewed.') }, 'Try the example'),
        h('button', { type: 'button', class: 'secondary', id: 'open', onclick: () => openInput.click() }, 'Open a saved project'),
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            id: 'new',
            onclick: () => {
              if (project.screens.length || Object.keys(project.answers).length) {
                if (!window.confirm('Start a new report? Save your project file first if you want to keep this one.')) return;
              }
              setProject(emptyProject(today()), 'Started a new, empty report.');
            },
          },
          'Start a new report',
        ),
        openInput,
      ),
      h(
        'details',
        { class: 'intro' },
        h('summary', {}, 'What is an ACR, and why do buyers ask for one?'),
        h('p', {}, 'Universities, schools and public agencies must buy accessible software (in the US, the ADA Title II rule requires WCAG 2.1 AA, with deadlines in 2027 and 2028). Their purchasing offices ask vendors for an Accessibility Conformance Report: the VPAT® template filled in, criterion by criterion, saying how well the product meets each one.'),
        h('p', {}, 'Agencies charge hundreds of dollars per screen to write one. ACR Draft gets you most of the way yourself: scan your key screens, answer a short guided test for each criterion, and export a report in the VPAT 2.5 WCAG edition layout.'),
        h('p', {}, 'It is built to keep you honest. It never marks a criterion "Supports" from an automated scan alone, it flags any claim your evidence does not back, and it prints an evidence appendix a procurement reviewer can check. The report is your own statement, not a certification.'),
      ),
    ),
    h('nav', {}, tablist),
    status,
    h('main', {}, panel),
  );

  openInput.addEventListener('change', async () => {
    const file = openInput.files?.[0];
    openInput.value = '';
    if (!file) return;
    try {
      setProject(parseProject(await file.text()), `Opened ${file.name}.`);
    } catch (e) {
      say((e as Error).message, true);
    }
  });

  function say(text: string, error = false): void {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function renderTabs(): void {
    const ev = evaluate(project);
    tablist.replaceChildren(
      ...TABS.map((t) => {
        const extra = t.id === 'review' ? ` (${ev.settled}/${CRITERIA.length})` : t.id === 'report' && ev.blocking ? ` (${ev.blocking} to fix)` : '';
        const b = h(
          'button',
          {
            type: 'button',
            role: 'tab',
            id: `tab-${t.id}`,
            'aria-controls': 'panel',
            'aria-selected': t.id === tab ? 'true' : 'false',
            tabindex: t.id === tab ? '0' : '-1',
            onclick: () => openTab(t.id),
          },
          t.label + extra,
        );
        b.addEventListener('keydown', (e) => {
          const i = TABS.findIndex((x) => x.id === tab);
          let next = -1;
          if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
          else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = TABS.length - 1;
          if (next < 0) return;
          e.preventDefault();
          openTab(TABS[next].id);
          (tablist.querySelector(`#tab-${TABS[next].id}`) as HTMLElement | null)?.focus();
        });
        return b;
      }),
    );
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
  }

  function changed(): void {
    persist();
    renderTabs();
  }

  function openTab(id: TabId): void {
    tab = id;
    renderTabs();
    renderPanel();
  }

  function renderPanel(): void {
    const views: Record<TabId, () => HTMLElement[]> = {
      product: productView,
      screens: screensView,
      review: reviewView,
      report: reportView,
      compare: compareView,
    };
    panel.replaceChildren(...views[tab]());
  }

  function setProject(p: Project, message?: string): void {
    project = p;
    previous = null;
    persist();
    if (message) say(message);
    openTab(tab);
  }

  // ---------- 1. product ----------
  function field(label: string, key: keyof Product, opts: { multiline?: boolean; hint?: string; type?: string } = {}): HTMLElement {
    const id = `f-${key}`;
    const input = opts.multiline
      ? h('textarea', { id, rows: '3' })
      : h('input', { id, type: opts.type ?? 'text', autocomplete: 'off' });
    input.value = project.product[key];
    input.addEventListener('input', () => {
      project.product[key] = input.value;
      changed();
    });
    if (opts.hint) input.setAttribute('aria-describedby', `${id}-hint`);
    return h('div', { class: 'field' }, h('label', { for: id }, label), opts.hint ? h('p', { class: 'hint', id: `${id}-hint` }, opts.hint) : null, input);
  }

  function productView(): HTMLElement[] {
    const gates = GATES.map((g) => {
      const name = `gate-${g.id}`;
      const fs = h('fieldset', { class: 'gate' }, h('legend', {}, g.question), h('p', { class: 'hint' }, `For example: ${g.example}`));
      const row = h('div', { class: 'choices' });
      for (const [v, l] of [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] as const) {
        const id = `${name}-${v}`;
        const r = h('input', { type: 'radio', name, id, value: v });
        r.checked = project.gates[g.id] === v;
        r.addEventListener('change', () => {
          project.gates[g.id] = v;
          changed();
        });
        row.append(h('span', { class: 'choice' }, r, h('label', { for: id }, l)));
      }
      fs.append(row);
      return fs;
    });
    return [
      h('h2', {}, 'About your product'),
      h('p', { class: 'hint' }, 'This goes at the top of the report. Buyers use it to see exactly which product and version you tested.'),
      h(
        'div',
        { class: 'grid2' },
        field('Product name', 'name'),
        field('Version', 'version', { hint: 'The release you tested, for example 4.2 or "October 2026".' }),
      ),
      field('Report date', 'reportDate', { type: 'date' }),
      field('Product description', 'description', { multiline: true, hint: 'One or two sentences a buyer would recognise.' }),
      field('Contact for accessibility questions', 'contact', { hint: 'Name or team, and an email address.' }),
      field('Browsers and assistive technology you test with', 'testedWith', { hint: 'For example: Chrome 130 on Windows 11 with NVDA; Safari on macOS with VoiceOver.' }),
      field('Notes for the report', 'notes', { multiline: true, hint: 'Scope and exclusions, for example "The mobile apps are not covered."' }),
      h('h2', {}, 'What your product contains'),
      h('p', { class: 'hint' }, 'Answering "No" marks the related criteria Not Applicable with a plain reason, so you skip tests that cannot apply. "Not sure" leaves them in the guided review.'),
      ...gates,
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => openTab('screens') }, 'Next: screens and scans')),
    ];
  }

  // ---------- 2. screens ----------
  function screenSummary(s: Screen): string {
    if (!s.scan) return 'Not scanned yet.';
    const c = countScan(s.scan);
    const how = s.scan.source === 'html-scan' ? 'Scanned from pasted HTML' : 'Imported axe results';
    return `${how} (${s.scan.engine}${s.scan.timestamp ? `, ${s.scan.timestamp.slice(0, 10)}` : ''}): ${c.violations} failed ${c.violations === 1 ? 'rule' : 'rules'} on ${c.elements} ${c.elements === 1 ? 'element' : 'elements'}, ${c.incomplete} to check by hand, ${c.passes} passed.`;
  }

  function importAxe(screenId: string, text: string): string {
    const screen = project.screens.find((s) => s.id === screenId);
    if (!screen) throw new Error('That screen no longer exists.');
    const scans = parseAxeText(text);
    screen.scan = scans[0];
    if (!screen.url && scans[0].url) screen.url = scans[0].url;
    const extra = scans.slice(1).map((sc) => ({ id: newId(), name: pageName(sc.url), url: sc.url, scan: sc }));
    project.screens.push(...extra);
    changed();
    return extra.length
      ? `Imported results for ${screen.name} and added ${extra.length} more ${extra.length === 1 ? 'screen' : 'screens'} from the same file.`
      : `Imported results for ${screen.name}.`;
  }

  function importCli(text: string): string {
    const scans = parseAxeText(text);
    const added = scans.map((sc) => ({ id: newId(), name: pageName(sc.url), url: sc.url, scan: sc }));
    project.screens.push(...added);
    changed();
    return `Added ${added.length} ${added.length === 1 ? 'screen' : 'screens'} from the file.`;
  }

  function pageName(url: string): string {
    try {
      const u = new URL(url);
      return u.pathname === '/' ? u.host : u.pathname.replace(/\/$/, '');
    } catch {
      return url || 'Imported page';
    }
  }

  function codeBlock(text: string, label: string): HTMLElement {
    const pre = h('pre', { tabindex: '0', 'aria-label': label }, h('code', {}, text));
    const copy = h(
      'button',
      {
        type: 'button',
        class: 'secondary small',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(text);
            say(`${label} copied.`);
          } catch {
            say('Your browser blocked copying. Select the text and copy it by hand.', true);
          }
        },
      },
      `Copy ${label.toLowerCase()}`,
    );
    return h('div', { class: 'code' }, pre, copy);
  }

  function screenCard(s: Screen): HTMLElement {
    const card = h('section', { class: 'screen', 'aria-label': s.name || 'Unnamed screen' });
    const nameId = `sn-${s.id}`;
    const urlId = `su-${s.id}`;
    const name = h('input', { id: nameId, type: 'text' });
    name.value = s.name;
    name.addEventListener('input', () => {
      s.name = name.value;
      card.setAttribute('aria-label', s.name || 'Unnamed screen');
      changed();
    });
    const url = h('input', { id: urlId, type: 'url', placeholder: 'https://app.example.com/page' });
    url.value = s.url;
    url.addEventListener('input', () => {
      s.url = url.value;
      changed();
    });
    const summary = h('p', { class: s.scan ? 'scan-ok' : 'hint' }, screenSummary(s));
    const work = h('div', { class: 'work' });

    const openPaste = (mode: 'axe' | 'html') => {
      const id = `paste-${mode}-${s.id}`;
      const area = h('textarea', { id, rows: '6', spellcheck: 'false' });
      const go = h('button', { type: 'button' }, mode === 'axe' ? 'Use these results' : 'Scan this HTML');
      const msg = h('p', { class: 'hint', 'aria-live': 'polite' });
      go.addEventListener('click', async () => {
        if (!area.value.trim()) {
          msg.textContent = 'Paste something first.';
          return;
        }
        if (mode === 'axe') {
          try {
            say(importAxe(s.id, area.value));
            renderPanel();
          } catch (e) {
            msg.textContent = (e as Error).message;
          }
          return;
        }
        go.disabled = true;
        msg.textContent = 'Scanning… this can take a few seconds.';
        try {
          const res = await scanHtml(area.value, s.url);
          s.scan = res.scan;
          changed();
          const notes = [
            res.removedScripts ? `${res.removedScripts} ${res.removedScripts === 1 ? 'script was' : 'scripts were'} removed before scanning.` : '',
            res.unstyled ? 'The HTML had no stylesheets, so contrast results may be wrong; add the screen address so its styles can load.' : '',
          ].filter(Boolean);
          say(`Scanned ${s.name}. ${notes.join(' ')}`.trim());
          renderPanel();
        } catch (e) {
          go.disabled = false;
          msg.textContent = `The scan failed: ${(e as Error).message}`;
        }
      });
      work.replaceChildren(
        h(
          'div',
          { class: 'paste' },
          h('label', { for: id }, mode === 'axe' ? 'Paste the axe results (JSON)' : 'Paste the page HTML'),
          mode === 'html'
            ? h('p', { class: 'hint' }, 'On the signed-in screen, open the DevTools console and run copy(document.documentElement.outerHTML), then paste here. Fill in the screen address above so its stylesheets load.')
            : null,
          area,
          h('div', { class: 'actions' }, go, h('button', { type: 'button', class: 'secondary', onclick: () => work.replaceChildren() }, 'Cancel')),
          msg,
        ),
      );
      area.focus();
    };

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-label': `axe results file for ${s.name || 'this screen'}` });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        say(importAxe(s.id, await file.text()));
        renderPanel();
      } catch (e) {
        say(`${file.name}: ${(e as Error).message}`, true);
      }
    });

    card.append(
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: nameId }, 'Screen name'), name), h('div', { class: 'field' }, h('label', { for: urlId }, 'Address'), url)),
      summary,
      h(
        'div',
        { class: 'actions tight' },
        h('button', { type: 'button', class: 'secondary small', onclick: () => openPaste('axe') }, 'Paste axe results'),
        h('button', { type: 'button', class: 'secondary small', onclick: () => fileInput.click() }, 'Upload axe file'),
        h('button', { type: 'button', class: 'secondary small', onclick: () => openPaste('html') }, 'Scan page HTML'),
        h(
          'button',
          {
            type: 'button',
            class: 'secondary small danger',
            onclick: () => {
              project.screens = project.screens.filter((x) => x.id !== s.id);
              changed();
              say(`Removed ${s.name || 'the screen'}.`);
              renderPanel();
            },
          },
          'Remove screen',
        ),
        fileInput,
      ),
      work,
    );
    return card;
  }

  function screensView(): HTMLElement[] {
    const cliInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-label': 'Command-line results file' });
    cliInput.addEventListener('change', async () => {
      const file = cliInput.files?.[0];
      cliInput.value = '';
      if (!file) return;
      try {
        say(importCli(await file.text()));
        renderPanel();
      } catch (e) {
        say(`${file.name}: ${(e as Error).message}`, true);
      }
    });
    const firstUrl = project.screens.find((s) => s.url)?.url ?? '';
    return [
      h('h2', {}, 'Screens and automated scans'),
      h('p', {}, 'List the screens a buyer\'s users will rely on: sign-in, the main dashboard, each core task (creating, taking, grading, paying), settings and help. Ten to twenty screens cover most products.'),
      h(
        'details',
        { class: 'howto' },
        h('summary', {}, 'How to get scan results for a screen (three ways)'),
        h('h3', {}, 'A. Console snippet (best for signed-in screens)'),
        h('ol', {}, h('li', {}, 'Open the screen in Chrome, Edge or Firefox, signed in as a normal user.'), h('li', {}, 'Open DevTools (F12) and choose Console.'), h('li', {}, 'Paste the snippet below and press Enter. It loads the free axe-core checker and copies its results.'), h('li', {}, 'Click "Paste axe results" on the screen below and paste.')),
        codeBlock(consoleSnippet(), 'Snippet'),
        h('p', { class: 'hint' }, 'If your app\'s security policy blocks the script, use method C.'),
        h('h3', {}, 'B. Command line (public pages)'),
        h('p', {}, 'For pages that need no sign-in. Saves one file covering every address you list; import it with "Import a command-line file".'),
        codeBlock(cliCommand(firstUrl), 'Command'),
        h('h3', {}, 'C. Paste the page HTML'),
        h('p', {}, 'In the console on the screen, run copy(document.documentElement.outerHTML). Then click "Scan page HTML" below and paste. ACR Draft scans it here with the same checker, with the page\'s scripts removed.'),
      ),
      ...(project.screens.length ? project.screens.map(screenCard) : [h('p', { class: 'empty' }, 'No screens yet. Add your first one, or try the example.')]),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            id: 'add-screen',
            onclick: () => {
              project.screens.push({ id: newId(), name: `Screen ${project.screens.length + 1}`, url: '', scan: null });
              changed();
              renderPanel();
              const inputs = panel.querySelectorAll<HTMLInputElement>('.screen input[type="text"]');
              inputs[inputs.length - 1]?.focus();
            },
          },
          'Add a screen',
        ),
        h('button', { type: 'button', class: 'secondary', onclick: () => cliInput.click() }, 'Import a command-line file'),
        cliInput,
        h('button', { type: 'button', class: 'secondary', onclick: () => openTab('review') }, 'Next: guided review'),
      ),
    ];
  }

  // ---------- 3. review ----------
  function needsAttention(r: CriterionResult): boolean {
    return r.warnings.length > 0;
  }

  function findingsList(r: CriterionResult): HTMLElement | null {
    if (!r.violations.length && !r.incomplete.length) {
      if (!r.criterion.automated) return h('p', { class: 'hint' }, 'Automated checkers cannot test this criterion; it needs a person.');
      if (!r.scannedScreens) return h('p', { class: 'hint' }, 'No scan results cover this criterion yet.');
      return h('p', { class: 'scan-ok' }, `Automated rules found no failures on ${r.scannedScreens} ${r.scannedScreens === 1 ? 'screen' : 'screens'}. That does not prove it passes: do the test below.`);
    }
    const items = [
      ...r.violations.map((f) =>
        h(
          'li',
          { class: 'fail-item' },
          h('strong', {}, 'Failed: '),
          f.helpUrl ? h('a', { href: f.helpUrl, target: '_blank', rel: 'noopener' }, f.help) : f.help,
          ` — ${f.screens.map((s) => `${s.screen} (${s.nodes})`).join(', ')}`,
          f.screens.some((s) => s.targets.length) ? h('div', { class: 'targets' }, ...f.screens.flatMap((s) => s.targets.map((t) => h('code', {}, t)))) : null,
        ),
      ),
      ...r.incomplete.map((f) => h('li', {}, h('strong', {}, 'Check by hand: '), f.help, ` — ${f.screens.map((s) => `${s.screen} (${s.nodes})`).join(', ')}`)),
    ];
    return h('ul', { class: 'findings' }, ...items);
  }

  function warningsList(r: CriterionResult): HTMLElement {
    return h('ul', { class: 'warnings' }, ...r.warnings.map((w) => h('li', { class: `w-${w.severity}` }, h('strong', {}, w.severity === 'block' ? 'Fix before sending: ' : 'Check: '), w.message)));
  }

  function criterionCard(c: Criterion): HTMLElement {
    const r = evaluateCriterion(project, c);
    const card = h('section', { class: 'crit', id: `c-${c.id.replace(/\./g, '-')}`, tabindex: '-1', 'aria-labelledby': `ch-${c.id}` });
    const badgeSlot = h('span', { class: 'badge-slot' }, levelBadge(r.level));
    const warnSlot = h('div', { class: 'warn-slot' }, warningsList(r));
    const remarkSlot = h('p', { class: 'remark' }, r.remark ? `Report remark: ${r.remark}` : '');
    const refresh = () => {
      const cur = evaluateCriterion(project, c);
      badgeSlot.replaceChildren(levelBadge(cur.level));
      warnSlot.replaceChildren(warningsList(cur));
      remarkSlot.textContent = cur.remark ? `Report remark: ${cur.remark}` : '';
      changed();
    };
    card.append(
      h('h4', { id: `ch-${c.id}` }, `${c.id} ${c.name}`, h('span', { class: 'lvl' }, ` Level ${c.level}${c.wcag21 ? ' · new in 2.1' : ''}`)),
      h('p', { class: 'crit-status' }, 'Report says: ', badgeSlot),
      h('p', {}, c.plain),
    );
    if (c.alwaysSupports) {
      card.append(h('p', { class: 'hint' }, c.alwaysSupports));
      return card;
    }
    const gate = c.gate ? GATES.find((g) => g.id === c.gate) : undefined;
    if (gate && project.gates[gate.id] === 'no') {
      card.append(h('p', { class: 'gate-note' }, `Not applicable because you answered No to "${gate.question}" on the Product step. Answer below only if that changes.`));
    }
    card.append(
      findingsList(r) ?? '',
      h('details', { class: 'steps' }, h('summary', {}, 'How to test'), h('ol', {}, ...c.steps.map((s) => h('li', {}, s)))),
    );
    const a = answerFor(project, c.id);
    const name = `o-${c.id}`;
    const fs = h('fieldset', { class: 'outcome' }, h('legend', {}, c.ask));
    const row = h('div', { class: 'choices' });
    for (const [v, l] of OUTCOME_LABELS) {
      const id = `${name}-${v}`;
      const radio = h('input', { type: 'radio', name, id, value: v });
      radio.checked = a.outcome === v;
      radio.addEventListener('change', () => {
        project.answers[c.id] = { ...answerFor(project, c.id), outcome: v };
        refresh();
      });
      row.append(h('span', { class: 'choice' }, radio, h('label', { for: id }, l)));
    }
    fs.append(row);
    const noteId = `n-${c.id}`;
    const note = h('textarea', { id: noteId, rows: '2', 'aria-describedby': `${noteId}-hint` });
    note.value = a.note;
    note.addEventListener('input', () => {
      project.answers[c.id] = { ...answerFor(project, c.id), note: note.value };
      refresh();
    });
    card.append(
      fs,
      h('label', { for: noteId }, 'Evidence note'),
      h('p', { class: 'hint', id: `${noteId}-hint` }, 'What you tested, where, with what, and what happened. This becomes the remark in the report.'),
      note,
      remarkSlot,
      warnSlot,
    );
    return card;
  }

  function reviewView(): HTMLElement[] {
    const ev = evaluate(project);
    const byId = new Map(ev.results.map((r) => [r.criterion.id, r]));
    const show = (c: Criterion) => {
      const r = byId.get(c.id)!;
      if (reviewFilter === 'attention') return needsAttention(r);
      if (reviewFilter === 'untested') return r.level === 'Not Evaluated';
      if (reviewFilter === 'failures') return r.violations.length > 0;
      return true;
    };
    const select = h('select', { id: 'filter' });
    for (const [v, l] of [
      ['all', 'All 50 criteria'],
      ['attention', 'Needs attention'],
      ['untested', 'Not evaluated yet'],
      ['failures', 'Automated failures'],
    ] as const) {
      const o = h('option', { value: v }, l);
      o.selected = reviewFilter === v;
      select.append(o);
    }
    select.addEventListener('change', () => {
      reviewFilter = select.value as typeof reviewFilter;
      renderPanel();
      (panel.querySelector('#filter') as HTMLElement | null)?.focus();
    });
    const groups: HTMLElement[] = [];
    for (const [num, principle] of Object.entries(PRINCIPLES)) {
      const list = CRITERIA.filter((c) => c.id.startsWith(`${num}.`) && show(c));
      if (!list.length) continue;
      groups.push(h('h3', {}, `${num}. ${principle}`), ...list.map(criterionCard));
    }
    return [
      h('h2', {}, 'Guided review'),
      h('p', {}, `For each WCAG 2.1 Level A and AA criterion, read what it asks, try the short test on your screens, and record what you found. ${ev.settled} of ${CRITERIA.length} are settled.`),
      h('progress', { max: String(CRITERIA.length), value: String(ev.settled), 'aria-label': 'Criteria settled' }),
      h('div', { class: 'field inline' }, h('label', { for: 'filter' }, 'Show'), select),
      ...(groups.length ? groups : [h('p', { class: 'empty' }, 'Nothing matches this filter.')]),
    ];
  }

  // ---------- 4. report ----------
  function goToCriterion(id: string): void {
    reviewFilter = 'all';
    openTab('review');
    const el = panel.querySelector<HTMLElement>(`#c-${id.replace(/\./g, '-')}`);
    el?.scrollIntoView?.({ block: 'start' });
    el?.focus();
  }

  function printReport(html: string): void {
    const frame = h('iframe', { title: 'Report for printing', class: 'print-frame' });
    frame.srcdoc = html;
    frame.addEventListener('load', () => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60000);
    });
    document.body.append(frame);
  }

  function reportView(): HTMLElement[] {
    const ev = evaluate(project);
    const model = buildReport(project, ev);
    const total = (l: Conformance) => ev.counts.A[l] + ev.counts.AA[l];
    const tiles = h(
      'div',
      { class: 'tiles' },
      ...(['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'Not Evaluated'] as Conformance[]).map((l) =>
        h('div', { class: `tile ${LEVEL_CLASS[l]}` }, h('span', { class: 'big' }, String(total(l))), h('span', {}, l)),
      ),
    );
    const issues = ev.results.flatMap((r) => r.warnings.map((w) => ({ r, w })));
    const jump = (r: CriterionResult, text: string) =>
      h('button', { type: 'button', class: 'link', onclick: () => goToCriterion(r.criterion.id) }, text);
    const issueList = (sev: 'block' | 'check') => {
      const mine = issues.filter((x) => x.w.severity === sev);
      const notYet = mine.filter((x) => x.w.kind === 'not-evaluated');
      const items: HTMLElement[] = mine
        .filter((x) => x.w.kind !== 'not-evaluated')
        .map((x) => h('li', {}, jump(x.r, `${x.r.criterion.id} ${x.r.criterion.name}`), `: ${x.w.message}`));
      if (notYet.length) {
        const ids: (HTMLElement | string)[] = [];
        notYet.forEach((x, i) => ids.push(...(i ? [', '] : []), jump(x.r, x.r.criterion.id)));
        items.unshift(
          h('li', { class: 'not-yet' }, h('strong', {}, `Not evaluated yet (${notYet.length}): `), 'VPAT 2.5 allows "Not Evaluated" only for AAA criteria, so each of these needs its guided test or a product answer. ', h('span', { class: 'ids' }, ...ids)),
        );
      }
      return h('ul', { class: 'issues' }, ...items);
    };
    const blocking = ev.blocking;
    const actions = h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          id: 'dl-docx',
          onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.disabled = true;
            say('Building the Word file…');
            try {
              downloadBlob(projectFileName(project, 'acr.docx'), await makeDocx(project));
              say('Word file downloaded.');
            } catch (err) {
              say(`Could not build the Word file: ${(err as Error).message}`, true);
            } finally {
              b.disabled = false;
            }
          },
        },
        'Download Word (.docx)',
      ),
      h('button', { type: 'button', class: 'secondary', id: 'dl-html', onclick: () => download(projectFileName(project, 'acr.html'), reportHtml(model), 'text/html') }, 'Download HTML'),
      h('button', { type: 'button', class: 'secondary', id: 'print', onclick: () => printReport(reportHtml(model)) }, 'Print or save as PDF'),
      h('button', { type: 'button', class: 'secondary', id: 'dl-project', onclick: () => saveProjectFile() }, 'Save project file'),
    );
    const preview = model.tables.map((t) =>
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h('caption', {}, t.title),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Criteria'), h('th', { scope: 'col' }, 'Conformance Level'), h('th', { scope: 'col' }, 'Remarks and Explanations'))),
          h('tbody', {}, ...t.rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.criterion), h('td', {}, levelBadge(r.level as Conformance)), h('td', {}, r.remark)))),
        ),
      ),
    );
    return [
      h('h2', {}, 'Your report'),
      tiles,
      blocking
        ? h('div', { class: 'callout bad' }, h('p', { class: 'verdict' }, `${blocking} ${blocking === 1 ? 'issue' : 'issues'} to fix before you send this to a buyer.`), h('p', {}, 'You can still download it: it will be marked DRAFT at the top until these are resolved.'), issueList('block'))
        : h('div', { class: 'callout good' }, h('p', { class: 'verdict' }, 'Every criterion has a level backed by your evidence.'), h('p', {}, 'Read the remarks once more as a buyer would, then download.')),
      ...(ev.checks ? [h('details', { class: 'checks' }, h('summary', {}, `${ev.checks} ${ev.checks === 1 ? 'thing' : 'things'} worth a second look`), issueList('check'))] : []),
      actions,
      h('p', { class: 'fine' }, 'Save the project file with each release. Next time, open it, re-scan, and use Compare releases to see what changed. The report is your statement about your product, not a certification or legal advice.'),
      h('h3', {}, 'Preview'),
      ...preview,
    ];
  }

  function saveProjectFile(): void {
    download(projectFileName(project), serializeProject(project, now()), 'application/json');
    say('Project file downloaded. Keep it with this release.');
  }

  // ---------- 5. compare ----------
  function compareWith(prev: Project): ProjectDiff {
    previous = prev;
    return diffProjects(prev, project);
  }

  function diffView(d: ProjectDiff): HTMLElement {
    const better = d.levelChanges.filter((c) => c.direction === 'better');
    const worse = d.levelChanges.filter((c) => c.direction === 'worse');
    const other = d.levelChanges.filter((c) => c.direction === 'changed');
    const list = (title: string, items: ProjectDiff['levelChanges'], cls: string) =>
      items.length
        ? h('div', { class: `delta ${cls}` }, h('h4', {}, `${title} (${items.length})`), h('ul', {}, ...items.map((c) => h('li', {}, `${c.id} ${c.name}: ${c.from} → ${c.to}`))))
        : null;
    const ruleText: Record<string, string> = { new: 'New failure', more: 'More elements', fewer: 'Fewer elements', fixed: 'Fixed' };
    return h(
      'section',
      { class: 'diff', 'aria-label': 'Comparison' },
      h('h3', {}, `${d.fromLabel} → ${d.toLabel}`),
      h('p', {}, `${d.levelChanges.length} ${d.levelChanges.length === 1 ? 'criterion' : 'criteria'} changed level; ${d.unchanged} stayed the same.`),
      list('Got worse', worse, 'worse'),
      list('Improved', better, 'better'),
      list('Other changes', other, 'other'),
      d.ruleChanges.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              {},
              h('caption', {}, 'Automated failures, all screens'),
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Rule'), h('th', { scope: 'col' }, 'Change'), h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'Now'))),
              h('tbody', {}, ...d.ruleChanges.map((r) => h('tr', { class: `rc-${r.status}` }, h('th', { scope: 'row' }, `${r.help} (${r.ruleId})`), h('td', {}, ruleText[r.status]), h('td', {}, String(r.from)), h('td', {}, String(r.to))))),
            ),
          )
        : h('p', {}, 'Automated failures are the same as before.'),
      d.screensAdded.length ? h('p', {}, `Screens added: ${d.screensAdded.join(', ')}.`) : null,
      d.screensRemoved.length ? h('p', {}, `Screens no longer tested: ${d.screensRemoved.join(', ')}. A buyer may ask why.`) : null,
    );
  }

  function compareView(): HTMLElement[] {
    const input = h('input', { type: 'file', accept: '.json,application/json', id: 'prev-file', class: 'visually-hidden', tabindex: '-1', 'aria-label': 'Earlier project file' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        compareWith(parseProject(await file.text()));
        say(`Compared with ${file.name}.`);
        renderPanel();
      } catch (e) {
        say(`${file.name}: ${(e as Error).message}`, true);
      }
    });
    const isSample = project.product.name === 'QuizNest' && project.screens.some((s) => s.id.startsWith('sample-'));
    return [
      h('h2', {}, 'Compare releases'),
      h('p', {}, 'Open the project file you saved for an earlier release. ACR Draft shows which criteria changed level and which automated failures are new or fixed, so you can update the report and catch regressions before a buyer does.'),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', onclick: () => input.click() }, 'Open an earlier project file'),
        isSample
          ? h(
              'button',
              {
                type: 'button',
                class: 'secondary',
                id: 'compare-example',
                onclick: () => {
                  compareWith(samplePrevious());
                  say('Compared the example with QuizNest 4.1.');
                  renderPanel();
                },
              },
              'Compare the example with QuizNest 4.1',
            )
          : null,
        input,
      ),
      previous ? diffView(diffProjects(previous, project)) : h('p', { class: 'empty' }, 'No earlier release loaded.'),
    ];
  }

  // ---------- start ----------
  let restored = false;
  if (storage) {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved) {
        project = parseProject(saved);
        restored = true;
      }
    } catch {
      project = emptyProject(today());
    }
  }
  if (restored) say('Restored your work from this browser.');
  openTab('product');

  return {
    project: () => project,
    setProject,
    openTab,
    importAxe,
    importCli,
    compareWith,
  };
}
