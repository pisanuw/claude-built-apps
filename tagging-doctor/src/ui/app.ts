/**
 * The scan screen: a drop area with "Choose files", progress, errors, the
 * document chooser and "Scan all" (AC-5), the findings, and the downloads.
 * Plain DOM; every dependency that touches the browser comes in through
 * AppDeps, so tests run it under jsdom.
 */
import { openProject, type Project } from '../core/project';
import { buildReport, downloadName, GROUP_HELP, GROUP_TITLES, reportHtml, reportJson, where, findingTitle } from '../core/report';
import { COULD_NOT_SCAN, findMainFiles, scanDocument, type DocumentScan, type Finding } from '../core/scan';
import { plainWords } from '../core/fixes';
import type { Group, StatusIndex } from '../core/status';
import { LIMITS, ZipError } from '../core/zip';

export interface AppDeps {
  loadStatus: () => Promise<StatusIndex>;
  now: () => Date;
  /** sessionStorage, or null where it is not available. */
  session: Pick<Storage, 'getItem' | 'setItem'> | null;
  download: (name: string, type: string, content: string) => void;
  /** Lets the browser paint between files. */
  pause: () => Promise<void>;
}

/** What the page needs from a dropped or chosen file. */
export interface DroppedFile {
  name: string;
  /** Checked before the file is read, so a huge file is never loaded. */
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const EMPTY_TEXT = 'Drop a zip of your LaTeX project, or one .tex file. Nothing is uploaded: the scan runs in your browser.';
export const NO_MAIN_TEXT = 'No .tex file with \\documentclass was found';

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
  </header>
  <main>
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
        <li>It does not compile anything, and it does not change your files. Files named like student records (grades, gradebook, roster, students) are left out and never read.</li>
      </ul>
    </section>
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
  }

  function showError(message: string) {
    error.replaceChildren(el('p', {}, message));
  }

  async function handleFile(file: DroppedFile): Promise<void> {
    reset();
    status.textContent = `Reading ${file.name}…`;
    const started = deps.now().getTime();
    try {
      if ((file.size ?? 0) > LIMITS.maxFileBytes) {
        throw new ZipError('too-big', 'This file is larger than 20 MB. Remove large images or PDFs from the zip and try again.');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      index = await deps.loadStatus();
      project = openProject(file.name, bytes);
      const p = project;
      mains = await findMainFiles(p, (done, total) => (status.textContent = `Reading file ${done} of ${total}`), deps.pause);
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
      status.textContent = '';
      project = null;
      const message = e instanceof ZipError ? e.message : 'Something went wrong while reading this file. Try again, or make the zip again.';
      renderCouldNotScan(message);
    }
  }

  function renderCouldNotScan(message: string) {
    showError(message);
    resultEl.hidden = false;
    resultEl.replaceChildren(el('h2', { id: 'result-h' }, COULD_NOT_SCAN), el('p', {}, 'Drop another file, or choose one with “Choose files”.'));
  }

  function renderNoMain() {
    const p = el('p', {}, `${NO_MAIN_TEXT}. A main file has a \\documentclass line and \\begin{document}.`);
    const again = el('button', { type: 'button' }, 'Choose another file');
    again.addEventListener('click', () => input.click());
    error.replaceChildren(p, again);
  }

  function renderDocs() {
    docsEl.hidden = false;
    const h = el('h2', { id: 'docs-h' }, `This zip holds ${mains.length} documents`);
    const intro = el('p', {}, 'Choose one to see its findings, or scan them all for a summary of each.');
    const all = el('button', { type: 'button', class: 'primary', id: 'scan-all' }, 'Scan all');
    all.addEventListener('click', () => {
      scanAll(shown);
      status.textContent = `Scanned all ${mains.length} documents.`;
    });
    const ul = el('ul', { class: 'doc-list' });
    for (const m of mains) {
      const li = el('li');
      const b = el('button', { type: 'button', 'data-doc': m }, `Scan ${m}`);
      b.addEventListener('click', () => {
        scanOne(m);
        status.textContent = `Scanned ${m}.`;
      });
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
      b.addEventListener('click', () => scanOne(m));
      td.append(b);
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    const total = mains.reduce((n, m) => n + (scans.get(m)?.summary.blockers ? 1 : 0), 0);
    allEl.replaceChildren(
      el('h2', { id: 'all-h' }, 'All documents'),
      el('p', {}, `${total} of ${mains.length} documents have blockers.`),
      wrapTable(table),
      downloads(),
    );
  }

  function downloads(): HTMLElement {
    const wrap = el('p', { class: 'downloads' });
    const html = el('button', { type: 'button' }, 'Download report');
    const json = el('button', { type: 'button' }, 'Download JSON');
    html.addEventListener('click', () => deps.download(downloadName((project as Project).name, 'html'), 'text/html', reportHtml(currentReport())));
    json.addEventListener('click', () => deps.download(downloadName((project as Project).name, 'json'), 'application/json', reportJson(currentReport())));
    wrap.append(html, ' ', json);
    return wrap;
  }

  function currentReport() {
    const p = project as Project;
    const docs = scannedAll ? mains.map((m) => scans.get(m) as DocumentScan) : [scans.get(shown as string) as DocumentScan];
    return buildReport(p.name, p.leftOut, p.warnings, docs, (index as StatusIndex).data, deps.now());
  }

  function renderResult(main: string) {
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
    const out: HTMLElement[] = [];
    out.push(el('h2', { id: 'result-h' }, s.summary.verdict));
    out.push(el('p', { class: 'doc-name' }, `Document: ${main}${p.name !== main ? ` in ${p.name}` : ''}`));
    out.push(
      el(
        'p',
        { class: 'counts' },
        `${s.summary.blockers} blockers, ${s.summary.warnings} warnings, ${s.summary.unknown} unknown, ${s.summary.ok} working with tagging.`,
      ),
    );
    for (const n of s.summary.notes) out.push(el('p', { class: 'note' }, n));
    if (p.warnings.length) {
      const sec = el('div', { class: 'project-warnings' });
      sec.append(el('h3', {}, 'About the files you dropped'));
      const ul = el('ul');
      for (const w of p.warnings) ul.append(el('li', {}, w.message));
      sec.append(ul);
      out.push(sec);
    }
    if (!scannedAll) out.push(downloads());
    const fg = s.figures;
    out.push(el('h3', {}, 'Figures'));
    out.push(
      el(
        'p',
        { class: 'figures' },
        `${fg.images} images (${fg.imagesWithoutAlt} without alt text), ${fg.tikz} TikZ pictures (${fg.tikzWithoutAlt} without alt text).`,
      ),
    );
    for (const g of ['blocker', 'warning', 'unknown', 'ok'] as Group[]) out.push(groupSection(s, g));
    out.push(
      el(
        'p',
        { class: 'meta' },
        `Package data as of ${data.asOf}: the LaTeX Project’s tagging status list (${data.source.url}, commit ${data.source.commit.slice(0, 7)}), ${data.source.licence}. Files read: ${s.filesRead.join(', ')}.`,
      ),
    );
    resultEl.replaceChildren(...out);
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

  return { handleFile };
}

function wrapTable(table: HTMLElement): HTMLElement {
  const d = el('div', { class: 'table-wrap' });
  d.append(table);
  return d;
}

/** The browser's download of a text file. */
export function browserDownload(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
