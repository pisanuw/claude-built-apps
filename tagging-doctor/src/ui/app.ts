/**
 * The page: the scan screen (a drop area with "Choose files", progress,
 * errors, the document chooser and "Scan all" (AC-5), the findings, the
 * downloads, and Save), the sign-in controls in the top bar (AC-16), and the
 * pages of src/ui/pages.ts behind hash routes (#/courses, #/course/<id>,
 * #/course/<id>/report, #/project/<id>, #/what-we-keep). Plain DOM; every
 * dependency that touches the browser comes in through AppDeps, so tests run
 * it under jsdom.
 */
import { leftOutDocumentsLines, openProject, type Project } from '../core/project';
import { buildReport, countsLine, downloadName, figuresLine, GROUP_HELP, GROUP_TITLES, leftOutLine, reportHtml, reportJson, where, findingTitle } from '../core/report';
import { COULD_NOT_SCAN, findMainFiles, scanDocument, wellFormed, type DocumentScan, type Finding } from '../core/scan';
import { plainWords } from '../core/fixes';
import type { Group, StatusIndex } from '../core/status';
import { LIMITS, ZipError } from '../core/zip';
import { defaultProjectName, toStoredScan, versionNames, type SaveItem } from '../core/saved';
import type { SavedResult } from '../lib/store';
import type { CourseStore } from '../lib/store';
import { jobRecord, type CheckerJob, type JobRecord } from '../core/compile';
import { finished } from '../core/compare';
import { mountCompile, KEPT, type CompileDeps } from './compile';
import { forgetRestored, mountFixes, newFixesState, type FixesState } from './fixes';
import { newChoice, type FiguresOpts } from './figures';
import { listFigures, type FigureItem } from '../core/figures';
import { altCopyOf, altSync, figureKeys, restoreAlts, restoredWords, type FigureKey } from '../lib/alts';
import type { CompareDeps, compareSlot as CompareSlot } from './compare';
import { KEEP_HASH, renderCourse, renderCourseReport, renderCourses, renderKeep, renderNotFound, renderProject, renderSaveDialog, type PageCtx } from './pages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id in a route, decoded, or null when it is malformed or not a UUID. */
export function routeId(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Sign-in and the signed-in person's saved data. */
export interface Account {
  /** Draws the sign-in controls into el: the two buttons, or the person and "Sign out" (AC-16). Returns their unmount. */
  mountSignIn(el: HTMLElement): () => void;
  /** Calls back with the person now and on every event of the sign-in library (the same person may come again). */
  onUser(cb: (user: { id: string } | null) => void): void;
  /** The signed-in person's saved courses. */
  store(): CourseStore;
  /** The signed-in person's access token, for the checker (milestone 3b). */
  token?(): Promise<string | null>;
  /**
   * Set when the account is still loading as the page is drawn (AC-53): false
   * once it is clear none came, and the page then offers no Save (R2.1-7).
   */
  loaded?: Promise<boolean>;
}

export interface AppDeps {
  loadStatus: () => Promise<StatusIndex>;
  now: () => Date;
  /** sessionStorage, or null where it is not available. */
  session: (Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: Storage['removeItem'] }) | null;
  download: (name: string, type: string, content: string) => void;
  /** Lets the browser paint between files. */
  pause: () => Promise<void>;
  /** Sign-in and saving; without it the page offers neither. */
  account?: Account;
  confirm?: (message: string) => boolean;
  print?: () => void;
  /** Compile and check (milestone 3b): present when the build turns it on and names the checker (src/lib/checker.ts). */
  compile?: Omit<CompileDeps, 'token' | 'session'>;
  /**
   * "Compile patched and compare" (AC-42): src/ui/compare.ts, present only when the build turns it on
   * (VITE_COMPARE_PATCHED, AC-80); offered with Compile and check, to a signed-in person.
   */
  compare?: { compareSlot: typeof CompareSlot };
  /** The browser's download of a file it made (the patched zip, AC-41); else the patched zip goes through `download`'s Blob path. */
  downloadBlob?: (name: string, blob: Blob) => void;
  /** Stand-ins for the figure panel's model call, image codec, key storage and thumbnails (milestone 5a); tests only. */
  figures?: Omit<FiguresOpts, 'project' | 'figures' | 'choices' | 'onChange' | 'signedIn'>;
}

/** sessionStorage key of a save asked for before signing in (it holds what a saved scan holds, no more). */
export const PENDING_KEY = 'tagging-doctor.pending-save';

interface PendingSave {
  mode: 'one' | 'all';
  items: SaveItem[];
  /** The drop the items are of, while the page is the same (R5b.1-3); null for another drop. */
  drop?: string | null;
}

/** What the page needs from a dropped or chosen file. */
export interface DroppedFile {
  name: string;
  /** Checked before the file is read, so a huge file is never loaded. */
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const EMPTY_TEXT = 'Drop a zip of your LaTeX project, or one .tex file. Nothing is uploaded: the scan runs in your browser.';
export const LOAD_FAILED = 'The package list could not be loaded. Check your connection and drop the file again. Your file was not sent anywhere.';

/** The figure panel’s line when a saved project's alt texts could not be read or written (AC-51). */
export const ALTS_NOT_READ = 'The saved alt texts could not be loaded, so none was filled in. The figures are as in this drop.';
export const ALTS_PROJECT_GONE = 'The saved project of this scan was deleted, so the approved alt texts are no longer saved. They are still on this page and go into the patched copy; choose Save to keep them in a project again.';
export const ALTS_NOT_SAVED = 'The approved alt texts could not be saved with the project. They are still on this page and go into the patched copy; approve one again to try saving once more.';

export const NO_MAIN_TEXT = 'No .tex file with \\documentclass was found';

/** The message when no document was found (AC-5), naming the folders whose .tex files were left out (AC-78). */
export function noMainMessage(p: Pick<Project, 'leftOut' | 'leftOutFolders'>): string {
  return [`${NO_MAIN_TEXT}.`, ...leftOutDocumentsLines(p), 'A main file has a \\documentclass line and \\begin{document}.'].join(' ');
}

interface Choice {
  all: boolean;
  doc: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function shellHtml(): string {
  return `
  <header class="top-bar">
    <h1>Tagging Doctor</h1>
    <nav class="pages" aria-label="Pages">
      <a href="#/">Scan</a>
      <a href="#/courses" id="nav-courses" hidden>My courses</a>
      <a href="${KEEP_HASH}">What we keep</a>
    </nav>
    <div id="signin"></div>
  </header>
  <main>
    <section id="page" aria-labelledby="page-h" hidden></section>
    <div id="scan-view">
    <div id="pending" class="pending" hidden></div>
    <p class="lede">Find out what stops your LaTeX course materials from producing a tagged PDF, file by file, before the April 2027 deadline.</p>
    <section id="drop" class="drop" aria-labelledby="drop-h">
      <h2 id="drop-h">Scan a project</h2>
      <p id="drop-text">${EMPTY_TEXT}</p>
      <p><button type="button" id="choose" class="primary">Choose files</button></p>
      <input type="file" id="file" accept=".zip,.tex,application/zip" hidden>
    </section>
    <p id="status" class="status" role="status" aria-live="polite"></p>
    <div id="error" class="error" role="alert"></div>
    <section id="docs" aria-labelledby="docs-h" hidden></section>
    <section id="all" aria-labelledby="all-h" hidden></section>
    <section id="result" aria-labelledby="result-h" tabindex="-1" hidden></section>
    <section class="about" aria-labelledby="about-h">
      <h2 id="about-h">What the scan does</h2>
      <ul>
        <li>It reads the main file, every file it inputs or includes, and the project's own class and style files.</li>
        <li>It looks up each class and package in the LaTeX Project's tagging status list, and checks the preamble for what tagging needs.</li>
        <li>It counts figures and how many have no alt text.</li>
        <li>It does not compile anything, and it does not change your files. Files named like student records (grades, gradebook, roster, students), and files in folders named so, are left out and never read.</li>
      </ul>
      <p>Signed in, you can save scans to a course and see the whole course at once. <a href="${KEEP_HASH}">What we keep</a> says what is stored.</p>
    </section>
    </div>
  </main>`;
}

export function mountApp(root: HTMLElement, deps: AppDeps) {
  root.innerHTML = shellHtml();
  const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  const input = $<HTMLInputElement>('file');
  const drop = $<HTMLElement>('drop');
  const status = $<HTMLElement>('status');
  const error = $<HTMLElement>('error');
  const docsEl = $<HTMLElement>('docs');
  const allEl = $<HTMLElement>('all');
  const resultEl = $<HTMLElement>('result');
  const pageEl = $<HTMLElement>('page');
  const scanView = $<HTMLElement>('scan-view');
  const pendingEl = $<HTMLElement>('pending');
  const navCourses = $<HTMLElement>('nav-courses');
  const savePanel = el('section', { id: 'save', class: 'save-panel', 'aria-labelledby': 'save-h' });
  savePanel.hidden = true;
  const compilePanel = el('section', { id: 'compile', class: 'compile-panel', 'aria-labelledby': 'compile-h' });
  compilePanel.hidden = true;
  let compileRun: { cancel: () => void } | null = null;
  /** The document the compile panel is for (R4a.1-7). */
  let compileFor: string | null = null;
  /** The panel opened last, which stands first after the buttons (R4a.2-4 f). */
  let newestPanel: 'compile' | 'fixes' = 'compile';
  const fixesPanel = el('section', { id: 'fixes', class: 'fixes-panel', 'aria-labelledby': 'fixes-h' });
  fixesPanel.hidden = true;
  let fixesRun: { cancel: () => void; say: (text: string) => void } | null = null;
  /** The document the fix panel is for, and each document's fix choices in this drop (milestone 4). */
  let fixesFor: string | null = null;
  let fixStates = new Map<string, FixesState>();
  /** Each document's finished check of its original in this drop, used again by the compare (S2-13). */
  let originals = new Map<string, CheckerJob>();
  /** The saved scan of each main file of this drop, so a job row can name it (AC-35). */
  let savedScans = new Map<string, { projectId: string; scanId: string }>();
  /** Each document's figures and their saved-text slots in this drop (AC-51). */
  let figureSlots = new Map<string, Promise<{ figures: FigureItem[]; keys: Map<string, FigureKey> }>>();
  /** The restores asked for in this drop, by document and person (AC-51). */
  let restoreAsked = new Set<string>();
  /** One alt-text sync at a time per saved project, so two never insert the same slot (AC-51). */
  const altChains = new Map<string, Promise<void>>();
  /** Finished jobs of this drop whose scan is not saved yet: saving keeps them (AC-27, "Save to keep this result"). */
  let unsavedJobs = new Map<string, { job: CheckerJob; kind: JobRecord['kind'] }[]>();
  let account = deps.account;
  let signedIn = false;
  /** The signed-in person's id; the dialog and the pages are redrawn only when it changes (R2.1-2). */
  let userId: string | null = null;
  /** Unmounts the sign-in controls drawn in the signed-out save panel (R2.1-9). */
  let unmountPanelSignIn: (() => void) | null = null;
  let saveItems: { mode: 'one' | 'all'; items: SaveItem[]; drop: string | null } | null = null;
  /** This page load, so a drop's name differs from one before a reload (R5b.1-3). */
  const pageLoad = Math.random().toString(36).slice(2);

  let project: Project | null = null;
  let index: StatusIndex | null = null;
  let mains: string[] = [];
  let scans = new Map<string, DocumentScan>();
  let shown: string | null = null;
  let scannedAll = false;

  $('choose').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void handleFile(f);
    input.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    if (files.length > 1) {
      showError('Drop one zip, or one .tex file. To scan several files, zip their folder.');
      return;
    }
    void handleFile(files[0]);
  });

  function choiceKey(name: string) {
    return `tagging-doctor.choice.${name}`;
  }
  function loadChoice(name: string): Choice | null {
    try {
      const raw = deps.session?.getItem(choiceKey(name));
      return raw ? (JSON.parse(raw) as Choice) : null;
    } catch {
      return null;
    }
  }
  function saveChoice(c: Choice) {
    if (!project) return;
    try {
      deps.session?.setItem(choiceKey(project.name), JSON.stringify(c));
    } catch {
      // Storage full or blocked: the choice is then not remembered.
    }
  }

  function reset() {
    error.textContent = '';
    for (const s of [docsEl, allEl, resultEl]) {
      s.hidden = true;
      s.replaceChildren();
    }
    scans = new Map();
    shown = null;
    scannedAll = false;
    hideSave();
    hideCompile();
    hideFixes();
    savedScans = new Map();
    unsavedJobs = new Map();
    fixStates = new Map();
    originals = new Map();
    figureSlots = new Map();
    restoreAsked = new Set();
  }

  function showError(message: string) {
    error.replaceChildren(el('p', {}, message));
  }

  /** Each drop gets a number; a drop that is no longer the newest stops at its next await. */
  let generation = 0;

  async function handleFile(file: DroppedFile): Promise<void> {
    const run = ++generation;
    const stale = () => run !== generation;
    reset();
    project = null;
    status.textContent = `Reading ${file.name}\u2026`;
    const started = deps.now().getTime();
    try {
      if ((file.size ?? 0) > LIMITS.maxFileBytes) {
        throw new ZipError('too-big', 'This file is larger than 20 MB. Remove large images or PDFs from the zip and try again.');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (stale()) return;
      let loaded: StatusIndex;
      try {
        loaded = await deps.loadStatus();
      } catch {
        if (stale()) return;
        status.textContent = '';
        renderCouldNotScan(LOAD_FAILED);
        return;
      }
      if (stale()) return;
      const p = openProject(file.name, bytes);
      const found = await findMainFiles(p, (done, total) => {
        if (!stale()) status.textContent = `Reading file ${done} of ${total}`;
      }, deps.pause, stale);
      if (stale()) return;
      // A message left by a drop of two files during this scan no longer applies.
      error.replaceChildren();
      // Everything the screen shows comes from this drop from here on.
      index = loaded;
      project = p;
      mains = found;
      scans = new Map();
      if (!mains.length) {
        status.textContent = '';
        renderNoMain();
        return;
      }
      if (mains.length === 1) {
        scanOne(mains[0]);
      } else {
        const remembered = loadChoice(p.name);
        renderDocs();
        if (remembered?.all) scanAll(remembered.doc);
        else if (remembered?.doc && mains.includes(remembered.doc)) scanOne(remembered.doc);
      }
      const secs = ((deps.now().getTime() - started) / 1000).toFixed(1);
      status.textContent = scans.size
        ? `Scan finished in ${secs} s: ${scans.size === 1 ? 'one document' : `${scans.size} documents`}.`
        : `This zip holds ${mains.length} documents. Choose one, or scan all.`;
    } catch (e) {
      if (stale()) return;
      failed(e);
    }
  }

  /** Any error from reading or scanning: a plain message, and the page stays usable. */
  function failed(e: unknown) {
    status.textContent = '';
    // The panels' document is gone with the page's: their checks are cancelled (R4a.2-4 g).
    hideCompile();
    hideFixes();
    project = null;
    docsEl.hidden = true;
    allEl.hidden = true;
    const message = e instanceof ZipError ? e.message : 'Something went wrong while reading this file. Try again, or make the zip again.';
    renderCouldNotScan(message);
  }

  /** Runs a button's scan with the same error handling as a drop. */
  function guarded(fn: () => void): () => void {
    return () => {
      try {
        fn();
      } catch (e) {
        failed(e);
      }
    };
  }

  function projectWarnings(p: Project): HTMLElement {
    const sec = el('div', { class: 'project-warnings' });
    sec.append(el('h3', {}, 'About the files you dropped'));
    const ul = el('ul');
    for (const w of p.warnings) ul.append(el('li', {}, w.message));
    sec.append(ul);
    const lo = leftOutLine(p.leftOut.length);
    if (lo) sec.append(el('p', { class: 'left-out' }, lo));
    return sec;
  }

  function renderCouldNotScan(message: string) {
    showError(message);
    resultEl.hidden = false;
    resultEl.replaceChildren(el('h2', { id: 'result-h' }, COULD_NOT_SCAN), el('p', {}, 'Drop another file, or choose one with “Choose files”.'));
  }

  function renderNoMain() {
    const p = el('p', {}, noMainMessage(project as Project));
    const again = el('button', { type: 'button' }, 'Choose another file');
    again.addEventListener('click', () => input.click());
    error.replaceChildren(p, again);
    const proj = project as Project;
    if (proj.warnings.length) error.append(projectWarnings(proj));
  }

  function renderDocs() {
    docsEl.hidden = false;
    const h = el('h2', { id: 'docs-h' }, `This zip holds ${mains.length} documents`);
    const intro = el('p', {}, 'Choose one to see its findings, or scan them all for a summary of each.');
    const all = el('button', { type: 'button', class: 'primary', id: 'scan-all' }, 'Scan all');
    all.addEventListener('click', guarded(() => {
      scanAll(shown);
      status.textContent = `Scanned all ${mains.length} documents.`;
    }));
    const ul = el('ul', { class: 'doc-list' });
    for (const m of mains) {
      const li = el('li');
      const b = el('button', { type: 'button', 'data-doc': m }, `Scan ${m}`);
      b.addEventListener('click', guarded(() => {
        scanOne(m);
        status.textContent = `Scanned ${m}.`;
      }));
      li.append(b);
      ul.append(li);
    }
    const allP = el('p');
    allP.append(all);
    docsEl.replaceChildren(h, intro, allP, ul);
  }

  function scanFor(main: string): DocumentScan {
    let s = scans.get(main);
    if (!s) {
      s = scanDocument(project as Project, main, index as StatusIndex);
      scans.set(main, s);
    }
    return s;
  }

  function scanOne(main: string) {
    scanFor(main);
    saveChoice({ all: scannedAll, doc: main });
    if (scannedAll) renderAll();
    renderResult(main);
  }

  function scanAll(preferred: string | null) {
    for (const m of mains) scanFor(m);
    scannedAll = true;
    const doc = preferred && mains.includes(preferred) ? preferred : mains[0];
    saveChoice({ all: true, doc });
    renderAll();
    renderResult(doc);
  }

  function renderAll() {
    allEl.hidden = false;
    const table = el('table', { class: 'summary' });
    table.append(el('caption', {}, 'One row per document'));
    const head = el('tr');
    for (const t of ['Document', 'Verdict', 'Blockers', 'Warnings', 'Details']) head.append(el('th', { scope: 'col' }, t));
    const thead = el('thead');
    thead.append(head);
    table.append(thead);
    const body = el('tbody');
    for (const m of mains) {
      const s = scans.get(m) as DocumentScan;
      const tr = el('tr');
      tr.append(
        el('td', {}, m),
        el('td', {}, s.summary.verdict),
        el('td', {}, String(s.summary.blockers)),
        el('td', {}, String(s.summary.warnings)),
      );
      const td = el('td');
      const b = el('button', { type: 'button', 'data-show': m }, m === shown ? 'Shown below' : 'Show details');
      b.setAttribute('aria-label', `Show details of ${m}`);
      b.addEventListener('click', guarded(() => scanOne(m)));
      td.append(b);
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    const total = mains.reduce((n, m) => n + (scans.get(m)?.summary.blockers ? 1 : 0), 0);
    // An open "Save all" dialog stays open, after the new buttons, with what was typed (R2.1-9).
    const keepDialog = allEl.contains(savePanel);
    allEl.replaceChildren(
      el('h2', { id: 'all-h' }, 'All documents'),
      el('p', {}, `${total} of ${mains.length} documents have blockers.`),
      wrapTable(table),
      downloads(),
    );
    if (keepDialog) allEl.querySelector('.downloads')?.after(savePanel);
    keepPanels(allEl);
  }

  /**
   * Puts the compile and fix panels back after the new buttons when their
   * container was drawn again for the same document ("Scan all"), so a running
   * check keeps its panel and its Cancel (R4a.1-7).
   */
  function keepPanels(container: HTMLElement) {
    const dl = container.querySelector('.downloads');
    if (!dl) return;
    // Each goes right after the buttons, the older first, so the newer ends up first, as it was (R4a.2-4 f).
    const panels: [HTMLElement, string | null][] = [
      [compilePanel, compileFor],
      [fixesPanel, fixesFor],
    ];
    if (newestPanel === 'compile') panels.reverse();
    for (const [panel, doc] of panels) if (doc !== null && doc === shown && !panel.isConnected) dl.after(panel);
  }

  function downloads(): HTMLElement {
    const wrap = el('p', { class: 'downloads' });
    const html = el('button', { type: 'button' }, 'Download report');
    const json = el('button', { type: 'button' }, 'Download JSON');
    html.addEventListener('click', () => deps.download(downloadName((project as Project).name, 'html'), 'text/html', reportHtml(currentReport())));
    json.addEventListener('click', () => deps.download(downloadName((project as Project).name, 'json'), 'application/json', reportJson(currentReport())));
    wrap.append(html, ' ', json);
    // Signed in or not (AC-37): the patch runs in the browser.
    const fixes = el('button', { type: 'button', class: 'fixes-open' }, 'Suggest fixes');
    fixes.addEventListener('click', () => openFixes(wrap));
    // The figure panel is part of the fix panel (D-141): the same copy takes the fixes and the alt texts.
    const alt = el('button', { type: 'button', class: 'figures-open' }, 'Alt text for figures');
    alt.addEventListener('click', () => openFixes(wrap, '#figures-h'));
    wrap.append(' ', fixes, ' ', alt);
    if (account) {
      const save = el('button', { type: 'button', class: 'save' }, scannedAll ? 'Save all to a course' : 'Save');
      save.addEventListener('click', () => openSave(wrap, scannedAll ? 'all' : 'one'));
      wrap.append(' ', save);
      if (deps.compile) {
        // Signed in only (SPEC §4, Scan screen); shown and hidden as the person signs in and out.
        const compile = el('button', { type: 'button', class: 'compile-open' }, 'Compile and check');
        compile.hidden = !signedIn;
        compile.addEventListener('click', () => openCompile(wrap));
        wrap.append(' ', compile);
      }
    }
    return wrap;
  }

  // ---- Compile and check (milestone 3b) ---------------------------------------

  function openCompile(after: HTMLElement) {
    const acc = account;
    if (!deps.compile || !acc || !project || !shown) return;
    const main = shown;
    hideCompile();
    after.after(compilePanel);
    compilePanel.hidden = false;
    compileFor = main;
    newestPanel = 'compile';
    compileRun = mountCompile(
      compilePanel,
      { ...deps.compile, token: async () => (acc.token ? acc.token() : null), session: deps.session },
      {
        project,
        mainFile: main,
        keep: (job) => {
          if (finished(job)) originals.set(main, job);
          return keepJob(main, job);
        },
        save: () => openSave(compilePanel, 'one', currentItems('one')),
        onClose: hideCompile,
      },
    );
    (compilePanel.querySelector('#compile-h') as HTMLElement | null)?.focus();
  }

  function hideCompile() {
    compileRun?.cancel();
    compileRun = null;
    compileFor = null;
    compilePanel.hidden = true;
    compilePanel.replaceChildren();
    compilePanel.remove();
  }

  /** Writes the job row when the scan of `main` is saved (AC-35); else keeps the job for a later save. */
  async function keepJob(main: string, job: CheckerJob, kind: JobRecord['kind'] = 'check'): Promise<boolean> {
    // Keyed as the save items name it (wellFormed).
    main = wellFormed(main);
    const saved = savedScans.get(main);
    const record = jobRecord(job, kind);
    if (!record) return false;
    if (!saved || !account || !signedIn) {
      // The last check of each kind waits for the save.
      unsavedJobs.set(main, [...(unsavedJobs.get(main) ?? []).filter((j) => j.kind !== kind), { job, kind }]);
      return false;
    }
    unsavedJobs.set(main, (unsavedJobs.get(main) ?? []).filter((j) => j.kind !== kind));
    await account.store().saveJob(saved.projectId, saved.scanId, record);
    return true;
  }

  // ---- Suggest fixes and compare (milestone 4) ------------------------------------

  function openFixes(after: HTMLElement, focus = '#fixes-h') {
    if (!project || !shown) return;
    // Open already for this document: only the focus moves, so a Draft all going on keeps running (R5a.1-8).
    if (fixesFor === shown && fixesPanel.isConnected && !fixesPanel.hidden) {
      (fixesPanel.querySelector(focus) as HTMLElement | null)?.focus();
      return;
    }
    hideFixes();
    after.after(fixesPanel);
    fixesPanel.hidden = false;
    fixesFor = shown;
    newestPanel = 'fixes';
    drawFixes();
    (fixesPanel.querySelector(focus) as HTMLElement | null)?.focus();
  }

  /** (Re)draws the fix panel for `fixesFor`, keeping the person's choices; the compare part only for a signed-in person. */
  function drawFixes() {
    if (!project || !fixesFor) return;
    const main = fixesFor;
    fixesRun?.cancel();
    const state = fixState(main);
    // Signed in: the saved project's alt texts come back for the unchanged files (AC-51), once per document and person.
    const asked = `${main}\u0000${userId ?? ''}`;
    if (signedIn && !restoreAsked.has(asked)) {
      restoreAsked.add(asked);
      void restoreFor(main);
    }
    const compare = deps.compare && deps.compile && account && signedIn ? deps.compare : null;
    const compile = deps.compile;
    const acc = account;
    fixesRun = mountFixes(fixesPanel, {
      project,
      scan: scans.get(main) as DocumentScan,
      state,
      downloadBlob: deps.downloadBlob ?? deps.compile?.downloadBlob ?? (() => {}),
      onClose: hideFixes,
      figures: { ...deps.figures, signedIn: () => signedIn },
      onAltsChange: () => void syncAlts(main),
      compareSlot:
        compare && compile && acc
          ? compare.compareSlot({
              checker: compile.checker,
              token: async () => (acc.token ? acc.token() : null),
              session: deps.session,
              original: () => originals.get(main) ?? null,
              rememberOriginal: (job) => void originals.set(main, job),
              keep: (job, kind) => keepJob(main, job, kind),
            } satisfies CompareDeps)
          : undefined,
    });
  }

  function hideFixes() {
    fixesRun?.cancel();
    fixesRun = null;
    fixesFor = null;
    fixesPanel.hidden = true;
    fixesPanel.replaceChildren();
    fixesPanel.remove();
  }

  function fixState(main: string): FixesState {
    let state = fixStates.get(main);
    if (!state) fixStates.set(main, (state = newFixesState()));
    return state;
  }

  /** The figures of `main` in this drop and their slots (AC-51), worked out once. */
  function slotsOf(main: string): Promise<{ figures: FigureItem[]; keys: Map<string, FigureKey> }> {
    let s = figureSlots.get(main);
    if (!s) {
      const figures = listFigures(project as Project, scans.get(main) as DocumentScan);
      s = figureKeys(project as Project, figures).then((keys) => ({ figures, keys }));
      figureSlots.set(main, s);
    }
    return s;
  }

  /**
   * Fills the figures of `main` the person has not started on from the saved
   * project's alt texts, where the file is unchanged (AC-51). The project is
   * the one this drop saved the document to, or else the one saved project
   * of the same name and main file; with none, or several, nothing is filled
   * until the scan is saved.
   */
  async function restoreFor(main: string): Promise<void> {
    if (!account || !signedIn || !project || !scans.has(main)) return;
    const p = project;
    const run = generation;
    const who = userId;
    const gone = () => run !== generation || project !== p || userId !== who;
    const state = fixState(main);
    const slots = slotsOf(main);
    try {
      const store = account.store();
      let projectId = savedScans.get(wellFormed(main))?.projectId ?? null;
      if (!projectId) {
        // The drop's own name first, then the name without a copy suffix ("hw1 (1).zip" is a new version of hw1, AC-73).
        const names = mains.length > 1 ? [wellFormed(main)] : versionNames(wellFormed(defaultProjectName(p.name)));
        for (const name of names) {
          const found = await store.projectsMatching(name, wellFormed(main));
          if (gone()) return;
          if (found.length > 1) return;
          if (found.length === 1) {
            projectId = found[0].id;
            break;
          }
        }
        if (!projectId) return;
      }
      const [rows, { figures, keys }] = await Promise.all([store.altTexts(projectId), slots]);
      if (gone()) return;
      const r = restoreAlts(figures, keys, rows, state.alts, newChoice);
      for (const id of [...r.restored, ...r.stale]) {
        // What came from this person's rows, so a change of person can take it back (R5b.1-1).
        const c = state.alts.get(id);
        if (c) state.restored.set(id, { text: c.text, status: c.status, note: c.note });
        state.drafting.draw?.(id);
      }
      const words = restoredWords(r.restored.length, r.stale.length);
      if (words && fixesFor === main) fixesRun?.say(words);
    } catch (e) {
      console.warn('tagging-doctor: the saved alt texts could not be read', e);
      if (!gone() && fixesFor === main) fixesRun?.say(ALTS_NOT_READ);
    }
  }

  /** Brings the saved project's alt texts to the person's choices for `main` (AC-51); one at a time per project. */
  function syncAlts(main: string): Promise<void> {
    const saved = savedScans.get(wellFormed(main));
    const state = fixStates.get(main);
    if (!account || !signedIn || !saved || !state || !project) return Promise.resolve();
    const p = project;
    const store = account.store();
    const slots = slotsOf(main);
    const who = userId;
    const next = (altChains.get(saved.projectId) ?? Promise.resolve())
      .then(async () => {
        // Queued by a person who has since signed out or changed: not sent as the next one (R5b.2-5 e).
        if (userId !== who) return;
        // The choices as they are when this sync's turn comes, so a quick run of changes ends in the last one.
        const { figures, keys } = await slots;
        const { want, drop } = altSync(figures, keys, state.alts);
        if (want.length || drop.length) await store.syncAltTexts(saved.projectId, want, drop);
        // What this version's copy carries of the saved texts, for the course report (AC-52, D-153).
        await store.setAltCopy(saved.scanId, altCopyOf(p, figures, keys, state.alts));
      })
      .catch((e) => {
        console.warn('tagging-doctor: the alt texts could not be saved', e);
        if (userId !== who) return;
        // The project was deleted (another tab, its page): the document is no longer saved, so Save can be chosen again (R5b.1-8 e).
        const gone = /foreign key/i.test(e instanceof Error ? e.message : String(e));
        if (gone && savedScans.get(wellFormed(main))?.projectId === saved.projectId) savedScans.delete(wellFormed(main));
        if (fixesFor === main && project === p) fixesRun?.say(gone ? ALTS_PROJECT_GONE : ALTS_NOT_SAVED);
      });
    altChains.set(saved.projectId, next);
    return next;
  }

  /** After a save: remember the saved scans, and write the rows of results shown before it (AC-27, AC-35). */
  function onSaved(items: SaveItem[], mode: 'one' | 'all', results: SavedResult[], drop: string | null) {
    // Items of another drop (the banner's, kept before a sign-in that reloaded the page) are saved, but not tied
    // to the documents on the page: their checks and alt texts are not this drop's (R5b.1-3).
    if (!sameDrop(items, mode, drop)) return;
    for (const r of results) {
      const item = mode === 'one' ? items[0] : items.find((i) => i.name.trim() === r.project.name);
      if (item) savedScans.set(item.mainFile, { projectId: r.project.id, scanId: r.scan.id });
    }
    // The saved project's alt texts come back first, then the person's approvals go to it (AC-51).
    const savedMains = new Set(results.map((r) => (mode === 'one' ? items[0] : items.find((i) => i.name.trim() === r.project.name))?.mainFile));
    for (const m of mains) if (savedMains.has(wellFormed(m)) && scans.has(m)) void restoreFor(m).then(() => syncAlts(m));
    for (const [main, jobs] of [...unsavedJobs]) {
      if (!savedScans.has(main)) continue;
      for (const { job, kind } of jobs) void keepJob(main, job, kind).then(
        (kept) => {
          if (!kept) return;
          const line = compilePanel.querySelector('.save-to-keep');
          line?.replaceWith(el('p', { class: 'kept' }, KEPT));
        },
        () => {
          const line = compilePanel.querySelector('.save-to-keep');
          line?.replaceWith(el('p', { class: 'help', role: 'alert' }, 'The scan is saved, but the check could not be added to its history.'));
        },
      );
    }
  }

  /**
   * Whether a save's items are the drop on the page: made from it, or (the
   * banner's, after a sign-in that reloaded the page) the same project
   * dropped again, with each item's name, main file and scan as the page's
   * now (R5b.1-3, R5b.2-5 d). A drop of another zip has another name.
   */
  function sameDrop(items: SaveItem[], mode: 'one' | 'all', drop: string | null): boolean {
    const now = currentDrop();
    if (now === null) return false;
    if (drop === now) return true;
    if (mode === 'one' && (!shown || !scans.has(shown))) return false;
    if (mode === 'all' && mains.some((m) => !scans.has(m))) return false;
    const here = currentItems(mode);
    const key = (i: SaveItem) => JSON.stringify([i.name.trim(), i.mainFile, i.scan]);
    return items.length === here.length && items.every((it, k) => key(it) === key(here[k]));
  }

  /** The drop on the page, as a save's items name it (R5b.1-3); null with none. */
  function currentDrop(): string | null {
    return project ? `${pageLoad}:${generation}` : null;
  }

  /** What a save of the scan on screen holds (AC-17, AC-23). */
  function currentItems(mode: 'one' | 'all'): SaveItem[] {
    const p = project as Project;
    const asOf = (index as StatusIndex).data.asOf;
    // Names go through wellFormed: the database refuses NUL and half characters in JSON (R2.2-3).
    if (mode === 'all') return mains.map((m) => ({ name: wellFormed(m), mainFile: wellFormed(m), scan: toStoredScan(scans.get(m) as DocumentScan, asOf) }));
    const main = shown as string;
    return [{ name: wellFormed(mains.length > 1 ? main : defaultProjectName(p.name)), mainFile: wellFormed(main), scan: toStoredScan(scans.get(main) as DocumentScan, asOf) }];
  }

  /** "Save": the save dialog when signed in; signed out, sign-in, keeping the save for after it (AC-16). */
  function openSave(after: HTMLElement, mode: 'one' | 'all', items: SaveItem[] = currentItems(mode), drop: string | null = currentDrop()) {
    saveItems = { mode, items, drop };
    after.after(savePanel);
    savePanel.hidden = false;
    drawSave();
    (savePanel.querySelector('#save-h') as HTMLElement | null)?.focus();
  }

  function drawSave() {
    if (!saveItems || !account) return;
    const { mode, items, drop } = saveItems;
    if (signedIn) {
      unmountPanelSignIn?.();
      unmountPanelSignIn = null;
      clearPending();
      // Signing in from the panel redraws it: keep the focus in it (acceptance m2, focus note).
      const active = document.activeElement;
      const hadFocus = !active || active === document.body || savePanel.contains(active);
      renderSaveDialog(savePanel, { store: account.store(), items, mode, onClose: closeSave, onSaved: (results) => onSaved(items, mode, results, drop) });
      if (hadFocus) (savePanel.querySelector('#save-h') as HTMLElement | null)?.focus();
      return;
    }
    writePending({ mode, items, drop });
    const h = el('h3', { id: 'save-h', tabindex: '-1' }, 'Sign in to save');
    const why = el('p', {}, 'Saving keeps this scan’s report under a course, so you can see the whole course at once. Sign in with Google or with a link by email:');
    const box = el('div', { class: 'save-signin' });
    const note = el('p', { class: 'help' });
    const keep = el('a', { href: KEEP_HASH }, 'What we keep');
    note.append('Your files stay in this browser. After signing in, choose “Save” again if the page asks. ', keep);
    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', closeSave);
    const actions = el('p');
    actions.append(cancel);
    unmountPanelSignIn?.();
    savePanel.replaceChildren(h, why, box, note, actions);
    unmountPanelSignIn = account.mountSignIn(box);
  }

  function hideSave() {
    saveItems = null;
    unmountPanelSignIn?.();
    unmountPanelSignIn = null;
    savePanel.hidden = true;
    savePanel.replaceChildren();
    savePanel.remove();
  }

  /** Cancel: the save asked for is dropped, also the one kept for after sign-in. */
  function closeSave() {
    hideSave();
    clearPending();
  }

  function readPending(): PendingSave | null {
    try {
      const raw = deps.session?.getItem(PENDING_KEY);
      const v = raw ? (JSON.parse(raw) as PendingSave) : null;
      return v && Array.isArray(v.items) && v.items.length ? v : null;
    } catch {
      return null;
    }
  }
  function writePending(v: PendingSave) {
    try {
      deps.session?.setItem(PENDING_KEY, JSON.stringify(v));
    } catch {
      // Storage full or blocked: the save is then asked for again after sign-in.
    }
  }
  function clearPending() {
    try {
      deps.session?.removeItem?.(PENDING_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  /** After a sign-in that reloaded the page: offer the save asked for before it. */
  function showPending() {
    const p = signedIn && !saveItems ? readPending() : null;
    pendingEl.hidden = !p;
    if (!p) {
      pendingEl.replaceChildren();
      return;
    }
    const names = p.items.map((i) => i.name).join(', ');
    const text = el('p', {}, `You scanned ${names} before signing in. Save ${p.items.length === 1 ? 'it' : 'them'} to a course?`);
    const go = el('button', { type: 'button', class: 'primary' }, p.mode === 'all' ? 'Save all to a course' : 'Save to a course');
    const actions = el('p');
    go.addEventListener('click', () => {
      pendingEl.hidden = true;
      pendingEl.replaceChildren();
      // After the banner, not inside it: the banner is hidden now (R2.1-1).
      openSave(pendingEl, p.mode, p.items, p.drop ?? null);
    });
    const drop = el('button', { type: 'button' }, 'Discard');
    drop.addEventListener('click', () => {
      clearPending();
      showPending();
    });
    actions.append(go, ' ', drop);
    pendingEl.replaceChildren(text, actions);
  }

  function currentReport() {
    const p = project as Project;
    const docs = scannedAll ? mains.map((m) => scans.get(m) as DocumentScan) : [scans.get(shown as string) as DocumentScan];
    return buildReport(p.name, p.leftOut, p.warnings, docs, (index as StatusIndex).data, deps.now(), p.leftOutFolders);
  }

  function renderResult(main: string) {
    // A compile, or fixes, of the document shown before no longer apply: cancelled, whether or not the
    // panel is still on the page, since drawing the summary again takes it off (R4a.1-7).
    if (compileFor !== null && compileFor !== main) hideCompile();
    if (fixesFor !== null && fixesFor !== main) hideFixes();
    shown = main;
    if (scannedAll) {
      for (const b of allEl.querySelectorAll<HTMLButtonElement>('button[data-show]')) {
        b.textContent = b.dataset.show === main ? 'Shown below' : 'Show details';
      }
    }
    const s = scans.get(main) as DocumentScan;
    const p = project as Project;
    const data = (index as StatusIndex).data;
    resultEl.hidden = false;
    // A dialog for the document shown before no longer applies.
    if (resultEl.contains(savePanel)) hideSave();
    const out: HTMLElement[] = [];
    out.push(el('h2', { id: 'result-h' }, s.summary.verdict));
    out.push(el('p', { class: 'doc-name' }, `Document: ${main}${p.name !== main ? ` in ${p.name}` : ''}`));
    out.push(el('p', { class: 'counts' }, countsLine(s.summary)));
    for (const n of s.summary.notes) out.push(el('p', { class: 'note' }, n));
    if (p.warnings.length) out.push(projectWarnings(p));
    if (!scannedAll) out.push(downloads());
    const fg = s.figures;
    out.push(el('h3', {}, 'Figures'));
    out.push(el('p', { class: 'figures' }, figuresLine(fg)));
    for (const g of ['blocker', 'warning', 'unknown', 'ok'] as Group[]) out.push(groupSection(s, g));
    out.push(
      el(
        'p',
        { class: 'meta' },
        `Package data as of ${data.asOf}: the LaTeX Project’s tagging status list (${data.source.url}, commit ${data.source.commit.slice(0, 7)}), ${data.source.licence}. Files read: ${s.filesRead.join(', ')}.`,
      ),
    );
    resultEl.replaceChildren(...out);
    keepPanels(scannedAll ? allEl : resultEl);
  }

  function groupSection(s: DocumentScan, g: Group): HTMLElement {
    const list = s.findings.filter((f) => f.severity === g);
    const wrap = g === 'ok' ? el('details', { class: `group ${g}` }) : el('section', { class: `group ${g}` });
    const title = `${GROUP_TITLES[g]} (${list.length})`;
    if (g === 'ok') wrap.append(el('summary', {}, title));
    else wrap.append(el('h3', {}, title));
    if (!list.length) {
      wrap.append(el('p', {}, 'None.'));
      return wrap;
    }
    wrap.append(el('p', { class: 'help' }, GROUP_HELP[g]));
    const ul = el('ul', { class: 'findings' });
    for (const f of list) ul.append(findingItem(f));
    wrap.append(ul);
    return wrap;
  }

  function findingItem(f: Finding): HTMLElement {
    const li = el('li', { class: `finding ${f.severity}`, 'data-rule': f.rule });
    if (f.package) li.dataset.package = f.package;
    const t = el('p', { class: 'f-title' });
    t.append(el('strong', {}, findingTitle(f)), ' ', el('span', { class: 'where' }, where(f)));
    li.append(t, el('p', {}, f.message));
    if (f.excerpt) li.append(el('pre', { class: 'excerpt' }, f.excerpt));
    const comment = plainWords(f.sourceComment);
    if (comment) li.append(el('p', { class: 'source' }, `The LaTeX Project says: “${comment}”`));
    if (f.sourceLink) {
      const p = el('p', { class: 'source' });
      const a = el('a', { href: f.sourceLink, rel: 'noopener' }, 'its entry in the status list');
      p.append('See ', a, '.');
      li.append(p);
    }
    if (f.fix) {
      const p = el('p', { class: 'fix' });
      p.append(el('strong', {}, `Suggested fix: ${f.fix.name}.`), ` ${f.fix.detail}`);
      li.append(p);
    }
    return li;
  }

  // ---- Pages and sign-in ----------------------------------------------------

  let routeGen = 0;
  let currentHash = '';
  const go = (hash: string) => {
    if (typeof location !== 'undefined' && location.hash !== hash) location.hash = hash;
    else void route(hash);
  };
  const pageCtx = (gen: number): PageCtx => ({
    store: () => (account && signedIn ? account.store() : null),
    now: deps.now,
    download: deps.download,
    confirm: deps.confirm ?? (() => true),
    print: deps.print ?? (() => {}),
    loadData: async () => (await deps.loadStatus()).data,
    current: () => gen === routeGen,
  });

  /** Shows the page a hash names; anything else is the scan screen. */
  async function route(hash: string): Promise<void> {
    const gen = ++routeGen;
    currentHash = hash;
    const h = hash.replace(/^#/, '');
    const m = /^\/(courses|what-we-keep|course\/([^/]+)(\/report)?|project\/([^/]+))$/.exec(h);
    if (!m) {
      pageEl.hidden = true;
      pageEl.replaceChildren();
      scanView.hidden = false;
      document.body.classList.remove('printing-report');
      return;
    }
    scanView.hidden = true;
    pageEl.hidden = false;
    document.body.classList.toggle('printing-report', !!m[3]);
    const ctx = pageCtx(gen);
    let done: Promise<void>;
    if (m[1] === 'courses') done = renderCourses(pageEl, ctx);
    else if (m[1] === 'what-we-keep') {
      renderKeep(pageEl);
      done = Promise.resolve();
    } else {
      // An id is a UUID; anything else (or a malformed escape) is a page that is not there (R2.1-9).
      const id = routeId(m[2] ?? m[4]);
      if (!id) {
        renderNotFound(pageEl, m[4] ? 'This project was not found. It may have been deleted.' : 'This course was not found. It may have been deleted.');
        done = Promise.resolve();
      } else if (m[2] && m[3]) done = renderCourseReport(pageEl, ctx, id);
      else if (m[2]) done = renderCourse(pageEl, ctx, id, go);
      else done = renderProject(pageEl, ctx, id, go);
    }
    const focusHeading = () => {
      const h = pageEl.querySelector('#page-h, #course-report-h') as HTMLElement | null;
      // The region is named by the heading it shows (R2.1-9).
      if (h) pageEl.setAttribute('aria-labelledby', h.id);
      h?.focus();
    };
    focusHeading();
    await done;
    if (gen === routeGen) focusHeading();
  }

  // An account that did not load is no account: Save goes, as for a build without one (R2.1-7, AC-53).
  void account?.loaded?.then((ok) => {
    if (ok) return;
    account = undefined;
    for (const b of root.querySelectorAll('button.save')) b.remove();
    if (saveItems) hideSave();
  });
  if (account) {
    account.mountSignIn($('signin'));
    let first = true;
    account.onUser((user) => {
      const id = user?.id ?? null;
      const changed = first || id !== userId;
      first = false;
      // The library sends SIGNED_IN again when the tab is shown, and TOKEN_REFRESHED:
      // the same person again changes nothing on the page (R2.1-2).
      if (!changed) return;
      userId = id;
      signedIn = !!id;
      navCourses.hidden = !signedIn;
      for (const b of root.querySelectorAll<HTMLButtonElement>('button.compile-open')) b.hidden = !signedIn;
      // Another person, or none: a compile panel of the one before goes (its token is theirs),
      // and so do that person's saved scans and unsaved checks, which are not the new person's (R3b.1-1).
      if (compileFor !== null) hideCompile();
      savedScans = new Map();
      unsavedJobs = new Map();
      // Texts and notes a restore read from the person before are theirs, not the page's: they go,
      // unless that person changed them since; the next person's own restore comes when the panel is drawn (R5b.1-1).
      for (const state of fixStates.values()) forgetRestored(state);
      restoreAsked = new Set();
      // That person's checks are not the new person's; the fix panel is drawn again, with or without the compare.
      originals = new Map();
      if (fixesFor !== null) drawFixes();
      if (saveItems) drawSave();
      showPending();
      // A page that depends on who is signed in is drawn again, also for another person (R2.1-9).
      if (!pageEl.hidden) void route(currentHash);
    });
  }
  if (typeof window !== 'undefined') window.addEventListener('hashchange', () => void route(location.hash));
  if (typeof location !== 'undefined' && location.hash) void route(location.hash);

  return { handleFile, route };
}

function wrapTable(table: HTMLElement): HTMLElement {
  const d = el('div', { class: 'table-wrap' });
  d.append(table);
  return d;
}

/** The browser's download of a text file. */
export function browserDownload(name: string, type: string, content: string): void {
  browserDownloadBlob(name, new Blob([content], { type }));
}

/** The browser's download of a file it holds (the checker's PDF). */
export function browserDownloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
