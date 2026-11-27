// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import css from './ui/styles.css?inline';
import { answer, type Answer, type Quote } from './core/answer.js';
import { formatFromName, locationLabel, titleFromName, type DocFormat, type ParsedDoc } from './core/docs.js';
import {
  gapReport,
  logCsv,
  markUnhelpful,
  mergeEntries,
  newEntry,
  parseLogFile,
  reportMarkdown,
  type LogEntry,
  type LogFile,
} from './core/gaps.js';
import { segments, type Mark } from './core/highlight.js';
import { escapeHtml } from './core/html.js';
import { LONG_LINK, MAX_DOC_CHARS, MAX_DOCS, decodePack, encodePack, packId, parsePack, validatePack, type CoursePack } from './core/pack.js';
import { SAMPLE_PACK, SAMPLE_QUESTIONS } from './core/sample.js';
import { buildIndex, type Index } from './core/search.js';
import { extractQuotes, verifyQuote, type Verdict } from './core/verify.js';

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

// ------------------------------------------------------------------ storage

const PACK_KEY = 'where-does-it-say:pack';

function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app still works for this visit */
  }
}

// ------------------------------------------------------------------ state

type Tab = 'ask' | 'check' | 'teach';

let pack: CoursePack = SAMPLE_PACK;
/** Where the current pack came from, shown in the header. */
let packSource: 'sample' | 'link' | 'local' = 'sample';
let docs: ParsedDoc[] = [];
let index: Index;
let pid = '';
let log: LogEntry[] = [];

let tab: Tab = 'ask';
let result: Answer | null = null;
let resultEntry: string | null = null;
let feedback: 'yes' | 'no' | null = null;
let viewDoc = '';
let marks: (Mark & { docId: string })[] = [];

let checkText = '';
let checkResults: { quote: string; verdict: Verdict }[] = [];

let imported: LogEntry[] = [];
let importMsg = '';
let shareLink = '';
let shareMsg = '';
let teachMsg = '';
let teachMsgKind: 'good' | 'bad' | '' = '';
let busy = false;

function logKey(): string {
  return `where-does-it-say:log:${pid}`;
}

function setPack(p: CoursePack, source: typeof packSource): void {
  pack = p;
  packSource = source;
  docs = parsePack(p);
  index = buildIndex(docs);
  pid = packId(p);
  log = load<LogEntry[]>(logKey()) ?? [];
  viewDoc = docs[0]?.id ?? '';
  result = null;
  marks = [];
  checkResults = [];
  shareLink = '';
  if (source !== 'link') save(PACK_KEY, p);
}

function docById(id: string): ParsedDoc | undefined {
  return docs.find((d) => d.id === id);
}

// ------------------------------------------------------------------ rendering helpers

const KIND_LABEL: Record<string, string> = {
  exact: 'Verified: exact words',
  normalized: 'Verified: exact words (spacing or quote marks differ)',
  case: 'Verified: same words (capitalization differs)',
  elided: 'Verified: fragments in order, joined by an ellipsis',
};

function renderBlocks(doc: ParsedDoc): string {
  const out: string[] = [];
  let page: number | undefined;
  doc.blocks.forEach((b) => {
    if (b.page && b.page !== page) {
      page = b.page;
      out.push(`<div class="page-mark" aria-hidden="true">Page ${page}</div>`);
    }
    const docMarks = marks.filter((m) => m.docId === doc.id);
    const inner = segments(doc.text, b.start, b.end, docMarks)
      .map((s) =>
        s.quote === undefined
          ? escapeHtml(s.text)
          : `<mark class="q${s.quote % 3}" data-quote="${s.quote}">${escapeHtml(s.text)}</mark>`,
      )
      .join('');
    const attr = `data-start="${b.start}"`;
    if (b.kind === 'heading') {
      const lvl = Math.min(6, (b.level ?? 2) + 2);
      out.push(`<h${lvl} class="doc-h" ${attr}>${inner}</h${lvl}>`);
    } else if (b.kind === 'item') out.push(`<div class="doc-item" ${attr}>${inner}</div>`);
    else if (b.kind === 'row') out.push(`<div class="doc-row" ${attr}>${inner}</div>`);
    else if (b.kind === 'code') out.push(`<pre class="doc-code" ${attr}>${inner}</pre>`);
    else out.push(`<p ${attr}>${inner}</p>`);
  });
  return out.join('');
}

function viewerHtml(): string {
  const doc = docById(viewDoc) ?? docs[0];
  if (!doc) return `<div class="panel viewer"><p class="muted">No documents yet. Add some in the Instructor tab.</p></div>`;
  const tabs = docs
    .map((d) => {
      const n = new Set(marks.filter((m) => m.docId === d.id).map((m) => m.quote)).size;
      return `<button role="tab" class="doctab" data-doc="${d.id}" aria-selected="${d.id === doc.id}">${escapeHtml(d.title)}${n ? ` <span class="badge">${n}</span>` : ''}</button>`;
    })
    .join('');
  return `<section class="panel viewer" aria-label="Course documents">
    <div class="doctabs" role="tablist" aria-label="Documents">${tabs}</div>
    <div class="doctext" id="doctext" tabindex="0" role="tabpanel" aria-label="${escapeHtml(doc.title)}">${renderBlocks(doc)}</div>
  </section>`;
}

function refreshViewer(scrollTo?: number): void {
  const slot = document.getElementById('viewer-slot');
  if (!slot) return;
  slot.innerHTML = viewerHtml();
  if (scrollTo === undefined) return;
  const pane = document.getElementById('doctext');
  const target = pane?.querySelector<HTMLElement>(`mark[data-quote="${scrollTo}"]`);
  if (pane && target) {
    pane.scrollTop = Math.max(0, target.offsetTop - pane.clientHeight / 3);
    if (window.matchMedia('(max-width: 900px)').matches) slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function showQuote(q: number): void {
  const m = marks.find((x) => x.quote === q);
  if (!m) return;
  viewDoc = m.docId;
  refreshViewer(q);
}

function quoteCard(q: Quote, i: number, faint = false): string {
  const kind = KIND_LABEL[q.verdict.kind];
  return `<article class="quote ${faint ? 'faint' : ''}">
    <blockquote class="q${i % 3}">${escapeHtml(q.text)}</blockquote>
    <div class="quote-meta">
      <span><strong>${escapeHtml(q.docTitle)}</strong>${q.location ? `, ${escapeHtml(q.location)}` : ''}</span>
      ${faint ? '' : `<span class="verified" title="The quoted words were checked against the document text before being shown.">&#10003; ${kind}</span>`}
      <button class="small" data-show="${i}">Show in document</button>
    </div>
  </article>`;
}

function resultHtml(): string {
  if (!result) {
    return `<div class="panel intro">
      <p>Ask a question about the course. Every answer is a sentence copied from the documents on the right, checked word for word and highlighted where it appears. If the documents do not say, you will be told so, and the question is logged so the instructor can fill the gap.</p>
      <p class="muted small">Try:</p>
      <div class="chips">${SAMPLE_QUESTIONS.map((q) => `<button class="chip" data-ask="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>
    </div>`;
  }
  const r = result;
  if (r.status === 'empty') return `<div class="panel"><p>Type a question with at least one content word (for example, "Is the late penalty per day?").</p></div>`;
  if (r.status === 'found') {
    const fb =
      feedback === null
        ? `<div class="feedback"><span>Did this answer your question?</span> <button class="small" data-fb="yes">Yes</button> <button class="small" data-fb="no">No, log it as a gap</button></div>`
        : feedback === 'yes'
          ? `<p class="muted small">Thanks.</p>`
          : `<p class="muted small">Logged for the instructor as a question the documents did not really answer.</p>`;
    return `<div class="panel">
      <h2>The documents say</h2>
      ${r.quotes.map((q, i) => quoteCard(q, i)).join('')}
      ${fb}
    </div>`;
  }
  const unknown = r.unknownTerms.length
    ? `<p>The documents never mention: ${r.unknownTerms.map((t) => `<code>${escapeHtml(t)}</code>`).join(', ')}.</p>`
    : '';
  const near = r.nearest.length
    ? `<details class="near"><summary>Closest passages (not an answer)</summary>${r.nearest.map((q, i) => quoteCard(q, i, true)).join('')}</details>`
    : '';
  return `<div class="panel notfound">
    <h2>Not stated in the course documents</h2>
    <p>None of the ${docs.length} document${docs.length === 1 ? '' : 's'} contains a sentence that answers this. Ask the course staff; your question has been logged (in this browser) so the instructor can see what the documents are missing.</p>
    ${unknown}
    ${near}
  </div>`;
}

function refreshResult(): void {
  const slot = document.getElementById('result-slot');
  if (slot) slot.innerHTML = resultHtml();
}

function recentHtml(): string {
  const recent = [...log].reverse().slice(0, 8);
  if (!recent.length) return '';
  const icon = (e: LogEntry) => (e.outcome === 'answered' ? '&#10003;' : e.outcome === 'unhelpful' ? '&#8856;' : '&#8212;');
  return `<details class="panel recent"><summary>Your recent questions (${log.length})</summary>
    <ul class="plain">${recent.map((e) => `<li><span class="oc ${e.outcome}" title="${e.outcome}">${icon(e)}</span> <button class="linkish" data-ask="${escapeHtml(e.question)}">${escapeHtml(e.question)}</button></li>`).join('')}</ul>
    <div class="controls"><button class="small" data-act="export-log">Export my log for the instructor</button></div>
    <p class="muted small">The log stays in this browser. Nothing is sent anywhere unless you export it and send the file yourself.</p>
  </details>`;
}

// ------------------------------------------------------------------ tabs

function askView(): string {
  return `<div class="ask-grid">
    <div>
      <form class="panel askform" id="askform">
        <label for="q" class="sr-only">Your question</label>
        <input id="q" name="q" type="search" autocomplete="off" placeholder="Ask about deadlines, grading, allowed tools..." maxlength="300" />
        <button class="primary" type="submit">Ask</button>
      </form>
      <div id="result-slot" aria-live="polite">${resultHtml()}</div>
      ${recentHtml()}
    </div>
    <div id="viewer-slot">${viewerHtml()}</div>
  </div>`;
}

function diffHtml(v: Verdict): string {
  if (v.ok || !v.closest) return '';
  const c = v.closest;
  const doc = docById(c.docId);
  const ops = c.diff
    .map((o) =>
      o.op === 'same'
        ? escapeHtml(o.text)
        : o.op === 'quote-only'
          ? `<del title="In the quote, not in the document">${escapeHtml(o.text)}</del>`
          : `<ins title="In the document, not in the quote">${escapeHtml(o.text)}</ins>`,
    )
    .join(' ');
  return `<div class="closest">
    <p class="small">Closest passage (${Math.round(c.similarity * 100)}% of words in common) in <strong>${escapeHtml(doc?.title ?? '')}</strong>${doc ? `, ${escapeHtml(locationLabel(doc, c.start))}` : ''}:</p>
    <p class="diff">${ops}</p>
    <p class="muted small"><del>struck</del> words appear only in the quote; <ins>underlined</ins> words are what the document actually says.</p>
  </div>`;
}

function checkView(): string {
  const rows = checkResults
    .map((r, i) => {
      const v = r.verdict;
      if (v.ok) {
        const doc = docById(v.docId);
        return `<li class="check ok"><span class="mark-ok">&#10003;</span><div><q>${escapeHtml(r.quote)}</q>
          <p class="small">${KIND_LABEL[v.kind]} in <strong>${escapeHtml(doc?.title ?? '')}</strong>${doc ? `, ${escapeHtml(locationLabel(doc, v.start))}` : ''}${v.occurrences > 1 ? ` (appears ${v.occurrences} times)` : ''}.
          <button class="small" data-show="${i}">Show in document</button></p></div></li>`;
      }
      const why =
        v.reason === 'too-short'
          ? 'Too short to count as evidence (fewer than four words match almost anywhere).'
          : v.reason === 'empty'
            ? 'Empty.'
            : v.closest && v.closest.similarity >= 0.5
              ? 'Not in the documents as written: the closest passage says something different.'
              : 'Not in the documents.';
      return `<li class="check bad"><span class="mark-bad">&#10007;</span><div><q>${escapeHtml(r.quote)}</q><p class="small">${why}</p>${diffHtml(v)}</div></li>`;
    })
    .join('');
  return `<div class="ask-grid">
    <div>
      <form class="panel" id="checkform">
        <h2>Check a quote</h2>
        <p>Paste an answer from anywhere (a chatbot, a classmate, a forum post). Text in quotation marks and <code>&gt;</code> blockquote lines are checked as quotes; if there are none, every sentence is. Each one must appear word for word in the course documents.</p>
        <label for="checktext" class="sr-only">Answer to check</label>
        <textarea id="checktext" name="checktext" rows="7" placeholder='e.g. The syllabus says "late submissions lose 10% of the points per week".'>${escapeHtml(checkText)}</textarea>
        <div class="controls"><button class="primary" type="submit">Check</button>
        <button type="button" class="small" data-act="check-example">Try an example</button></div>
      </form>
      ${checkResults.length ? `<div class="panel"><h2>Results</h2><ul class="plain checks">${rows}</ul></div>` : ''}
    </div>
    <div id="viewer-slot">${viewerHtml()}</div>
  </div>`;
}

function teachView(): string {
  const docRows = pack.docs
    .map((d, i) => {
      const parsed = docs[i];
      return `<li class="docrow">
        <input aria-label="Title of document ${i + 1}" data-title="${i}" value="${escapeHtml(d.title)}" maxlength="200" />
        <span class="muted small">${d.format}, ${parsed ? parsed.text.length.toLocaleString('en-US') : 0} characters, ${parsed ? parsed.blocks.length : 0} blocks</span>
        <button class="small" data-view="${i}">View</button>
        <button class="small" data-remove="${i}" aria-label="Remove ${escapeHtml(d.title)}">Remove</button>
      </li>`;
    })
    .join('');
  const all = mergeEntries(log, imported);
  const rep = gapReport(all);
  const weeks = rep.weeks
    .map(
      (w) => `<h4>Week of ${w.week} <span class="muted small">(${w.count})</span></h4>
      <ul class="gaps">${w.clusters
        .map(
          (c) => `<li><strong>${escapeHtml(c.label)}</strong>${c.questions.length > 1 ? ` <span class="badge">${c.questions.length}&times;</span>` : ''}${c.questions.some((q) => q.outcome === 'unhelpful') ? ' <span class="tag">answer marked unhelpful</span>' : ''}
          ${c.questions.length > 1 ? `<ul>${c.questions.filter((q) => q.question !== c.label).map((q) => `<li>${escapeHtml(q.question)}</li>`).join('')}</ul>` : ''}</li>`,
        )
        .join('')}</ul>`,
    )
    .join('');
  return `<div class="teach">
    <section class="panel">
      <h2>1. Course documents</h2>
      <p>Add the syllabus, assignment specs and policies. PDF, Markdown and plain text files are read in this browser; nothing is uploaded. For a PDF, the text is extracted and shown as text, so check it in the viewer.</p>
      <ul class="plain docs">${docRows || '<li class="muted">No documents.</li>'}</ul>
      <div class="drop" id="drop" role="group" aria-label="Add files: PDF, Markdown or text">
        <strong>Drop files here</strong> or <label class="btn small filebtn">choose files<input type="file" id="files" multiple accept=".pdf,.md,.markdown,.txt,text/plain,text/markdown,application/pdf" /></label>
      </div>
      <details class="paste"><summary>Or paste text</summary>
        <div class="paste-grid">
          <label>Title <input id="paste-title" maxlength="200" placeholder="Late policy" /></label>
          <label>Format <select id="paste-format"><option value="markdown">Markdown</option><option value="text">Plain text</option></select></label>
        </div>
        <label for="paste-text" class="sr-only">Document text</label>
        <textarea id="paste-text" rows="6" placeholder="Paste the document here"></textarea>
        <div class="controls"><button class="small" data-act="paste-add">Add document</button></div>
      </details>
      <div class="controls">
        <label>Course title <input id="pack-title" value="${escapeHtml(pack.title)}" maxlength="200" /></label>
      </div>
      <div class="controls">
        <button class="small" data-act="load-sample">Load the sample course</button>
        <button class="small" data-act="clear-docs">Start empty</button>
      </div>
      <p class="status ${teachMsgKind}" role="status">${escapeHtml(teachMsg)}</p>
    </section>

    <section class="panel">
      <h2>2. Share with students</h2>
      <p>The student link carries the documents inside it (compressed, after the <code>#</code>, which browsers never send to a server). Anyone with the link can read the documents.</p>
      <div class="controls">
        <button class="primary" data-act="make-link" ${pack.docs.length ? '' : 'disabled'}>Create student link</button>
        <button class="small" data-act="download-pack" ${pack.docs.length ? '' : 'disabled'}>Download pack (JSON)</button>
      </div>
      ${shareLink ? `<div class="share"><label for="share">Student link <span class="muted small">(${shareLink.length.toLocaleString('en-US')} characters)</span></label><div class="controls"><input id="share" readonly value="${escapeHtml(shareLink)}" /><button class="small" data-act="copy-link">Copy</button></div></div>` : ''}
      ${shareMsg ? `<p class="note">${escapeHtml(shareMsg)}</p>` : ''}
      <p class="muted small">For very long packs, host the downloaded JSON anywhere that allows cross-origin reads (a GitHub raw file or a course web page) and share <code>${escapeHtml(location.origin + location.pathname)}?pack=&lt;url of the JSON&gt;</code>.</p>
    </section>

    <section class="panel">
      <h2>3. Gap report</h2>
      <p>Questions the documents could not answer, and answers students marked as unhelpful, grouped by week and by similar wording. Students export their logs from the Ask tab; load the files here. This browser's own questions are included.</p>
      <div class="controls">
        <label class="btn small filebtn">Load student logs<input type="file" id="logs" multiple accept=".json,application/json" /></label>
        <button class="small" data-act="report-md" ${rep.total ? '' : 'disabled'}>Download report (Markdown)</button>
        <button class="small" data-act="report-csv" ${rep.total ? '' : 'disabled'}>Download all questions (CSV)</button>
        <button class="small" data-act="clear-log" ${log.length ? '' : 'disabled'}>Clear this browser's log</button>
      </div>
      ${importMsg ? `<p class="note">${escapeHtml(importMsg)}</p>` : ''}
      <div class="stats">
        <div><span class="n">${rep.total}</span> questions</div>
        <div><span class="n">${rep.answered}</span> answered from the documents</div>
        <div><span class="n">${rep.gaps}</span> gaps</div>
      </div>
      ${rep.missingWords.length ? `<h3>Words students used that the documents never contain</h3><p class="words">${rep.missingWords.map((m) => `<span class="tag">${escapeHtml(m.word)} <span class="muted">${m.count}</span></span>`).join(' ')}</p>` : ''}
      ${weeks || '<p class="muted">No gaps logged yet.</p>'}
    </section>
  </div>`;
}

function headerHtml(): string {
  const src =
    packSource === 'sample' ? 'Sample course' : packSource === 'link' ? 'Opened from a course link' : 'Documents saved in this browser';
  const nav = (t: Tab, label: string) => `<button data-tab="${t}" ${tab === t ? 'aria-current="page"' : ''}>${label}</button>`;
  // The title and the light and dark mode switch on one row; the tagline and the course below, side by side when they fit.
  return `<header class="site">
      <div class="title-row"><h1>Where Does It Say</h1><hw-theme-toggle></hw-theme-toggle></div>
      <div class="site-meta">
        <p class="tagline">Answers only with sentences from the course documents, or says they do not say.</p>
        <p class="course"><strong>${escapeHtml(pack.title)}</strong><br /><span class="muted small">${src}, ${docs.length} document${docs.length === 1 ? '' : 's'}</span></p>
      </div>
    </header>
    <nav class="views" aria-label="Views">${nav('ask', 'Ask')}${nav('check', 'Check a quote')}${nav('teach', 'Instructor')}</nav>`;
}

function render(): void {
  const body = tab === 'ask' ? askView() : tab === 'check' ? checkView() : teachView();
  app!.innerHTML = `<div class="wrap">${headerHtml()}<main>${body}</main>
    <footer class="muted small">Runs entirely in your browser. Quotes are found by keyword search and checked word for word against the documents; a quote can be real and still miss the point, so read it in context. <a href="https://github.com/pisanuw/Claude-capstone/tree/main/where-does-it-say">Source</a></footer></div>`;
}

// ------------------------------------------------------------------ actions

/** Highlights for the current answer: its quotes, or the nearest passages when nothing qualified. */
function marksFromResult(): void {
  marks = [];
  if (!result) return;
  const shown = result.status === 'found' ? result.quotes : result.nearest;
  shown.forEach((q, i) => {
    const parts = q.verdict.parts ?? [{ start: q.start, end: q.end }];
    for (const p of parts) marks.push({ docId: q.docId, start: p.start, end: p.end, quote: i });
  });
}

function ask(question: string): void {
  result = answer(index, question);
  feedback = null;
  resultEntry = null;
  marksFromResult();
  if (result.status !== 'empty') {
    const cited = result.quotes.map((q) => `${q.docTitle}: ${q.location}`);
    const e = newEntry(question, result.status === 'found' ? 'answered' : 'not-found', result.unknownTerms, new Date(), cited);
    log = [...log, e];
    resultEntry = e.id;
    save(logKey(), log);
  }
  const input = document.getElementById('q') as HTMLInputElement | null;
  if (input && input.value !== question) input.value = question;
  if (marks.length && result.status === 'found') {
    viewDoc = marks[0].docId;
    refreshResult();
    refreshViewer(0);
  } else {
    refreshResult();
    refreshViewer();
  }
}

function runCheck(text: string): void {
  checkText = text;
  checkResults = extractQuotes(text).slice(0, 20).map((quote) => ({ quote, verdict: verifyQuote(docs, quote) }));
  marks = [];
  checkResults.forEach((r, i) => {
    if (!r.verdict.ok) return;
    const parts = r.verdict.parts ?? [{ start: r.verdict.start, end: r.verdict.end }];
    for (const p of parts) marks.push({ docId: r.verdict.docId, start: p.start, end: p.end, quote: i });
  });
  render();
  const first = marks[0];
  if (first) {
    viewDoc = first.docId;
    refreshViewer(first.quote);
  }
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'course';
}

function teachStatus(msg: string, kind: typeof teachMsgKind = ''): void {
  teachMsg = msg;
  teachMsgKind = kind;
}

function updatePack(next: CoursePack, msg?: string): void {
  setPack(next, 'local');
  if (msg) teachStatus(msg, 'good');
  render();
}

async function addFiles(files: FileList | File[]): Promise<void> {
  if (busy) return;
  busy = true;
  const added: string[] = [];
  const problems: string[] = [];
  const next: CoursePack = { ...pack, docs: [...pack.docs] };
  teachStatus('Reading files...');
  render();
  for (const f of Array.from(files)) {
    if (next.docs.length >= MAX_DOCS) {
      problems.push(`${f.name}: a pack holds at most ${MAX_DOCS} documents`);
      break;
    }
    const format: DocFormat | null = formatFromName(f.name) ?? (f.type === 'application/pdf' ? 'pdf' : f.type.startsWith('text/') ? 'text' : null);
    if (!format) {
      problems.push(`${f.name}: not a PDF, Markdown or text file`);
      continue;
    }
    try {
      let source: string;
      if (format === 'pdf') {
        const { extractPdfText } = await import('./ui/pdf.js');
        const { text } = await extractPdfText(await f.arrayBuffer());
        source = text;
        if (source.replace(/\s/g, '').length < 20) {
          problems.push(`${f.name}: no text layer found (a scanned PDF needs OCR first)`);
          continue;
        }
      } else source = await f.text();
      if (source.length > MAX_DOC_CHARS) {
        problems.push(`${f.name}: longer than ${MAX_DOC_CHARS.toLocaleString('en-US')} characters`);
        continue;
      }
      next.docs.push({ title: titleFromName(f.name), format, source });
      added.push(f.name);
    } catch (err) {
      problems.push(`${f.name}: ${err instanceof Error ? err.message : 'could not be read'}`);
    }
  }
  busy = false;
  if (added.length) setPack(next, 'local');
  teachStatus(
    [added.length ? `Added ${added.join(', ')}.` : '', problems.length ? `Skipped ${problems.join('; ')}.` : ''].filter(Boolean).join(' '),
    problems.length && !added.length ? 'bad' : 'good',
  );
  render();
}

async function importLogs(files: FileList): Promise<void> {
  const msgs: string[] = [];
  let count = 0;
  for (const f of Array.from(files)) {
    const parsed = parseLogFile(await f.text());
    if ('error' in parsed) {
      msgs.push(`${f.name}: ${parsed.error}`);
      continue;
    }
    if (parsed.packId && parsed.packId !== pid) msgs.push(`${f.name} was made with a different version of the documents (${parsed.packTitle || 'untitled'}); included anyway.`);
    imported = mergeEntries(imported, parsed.entries);
    count += parsed.entries.length;
  }
  importMsg = [`Loaded ${count} question${count === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}.`, ...msgs].join(' ');
  render();
}

// ------------------------------------------------------------------ events

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  if (form.id === 'askform') {
    const q = (form.querySelector('#q') as HTMLInputElement).value;
    if (q.trim()) ask(q);
  } else if (form.id === 'checkform') {
    runCheck((form.querySelector('#checktext') as HTMLTextAreaElement).value);
  }
});

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('button, [role="button"]');
  if (!el) return;
  const d = el.dataset;
  if (d.tab) {
    tab = d.tab as Tab;
    if (tab !== 'check') checkResults = [];
    if (tab === 'check') marks = [];
    if (tab === 'ask') marksFromResult();
    render();
    if (tab === 'ask' && marks.length) refreshViewer(0);
  } else if (d.ask !== undefined) {
    if (tab !== 'ask') {
      tab = 'ask';
      render();
    }
    ask(d.ask);
  } else if (d.show !== undefined) {
    showQuote(Number(d.show));
  } else if (d.doc) {
    viewDoc = d.doc;
    refreshViewer();
    const first = marks.find((m) => m.docId === d.doc);
    if (first) refreshViewer(first.quote);
  } else if (d.fb) {
    feedback = d.fb as 'yes' | 'no';
    if (feedback === 'no' && resultEntry) {
      log = markUnhelpful(log, resultEntry);
      save(logKey(), log);
    }
    refreshResult();
  } else if (d.view !== undefined) {
    viewDoc = docs[Number(d.view)]?.id ?? viewDoc;
    tab = 'ask';
    marks = [];
    result = null;
    render();
  } else if (d.remove !== undefined) {
    const i = Number(d.remove);
    const next = { ...pack, docs: pack.docs.filter((_, k) => k !== i) };
    updatePack(next, `Removed ${pack.docs[i]?.title ?? 'document'}.`);
  } else if (d.act) action(d.act);
});

function action(act: string): void {
  switch (act) {
    case 'export-log': {
      const file: LogFile = { kind: 'where-does-it-say-log', v: 1, packId: pid, packTitle: pack.title, entries: log };
      download(`questions-${slug(pack.title)}.json`, JSON.stringify(file, null, 2), 'application/json');
      break;
    }
    case 'check-example':
      runCheck(
        'According to the syllabus, "late submissions lose 10% of the points per week, up to three days." ' +
          'It also says "Calculators, phones and laptops are not allowed during exams." ' +
          'And the AI policy says "AI tools are allowed on every lab as long as you cite them."',
      );
      break;
    case 'paste-add': {
      const title = (document.getElementById('paste-title') as HTMLInputElement).value.trim() || 'Pasted document';
      const format = (document.getElementById('paste-format') as HTMLSelectElement).value as DocFormat;
      const text = (document.getElementById('paste-text') as HTMLTextAreaElement).value;
      if (!text.trim()) {
        teachStatus('Paste some text first.', 'bad');
        render();
        return;
      }
      if (pack.docs.length >= MAX_DOCS || text.length > MAX_DOC_CHARS) {
        teachStatus(`A pack holds at most ${MAX_DOCS} documents of up to ${MAX_DOC_CHARS.toLocaleString('en-US')} characters.`, 'bad');
        render();
        return;
      }
      updatePack({ ...pack, docs: [...pack.docs, { title, format, source: text }] }, `Added ${title}.`);
      break;
    }
    case 'load-sample':
      updatePack(structuredClone(SAMPLE_PACK), 'Loaded the sample course.');
      packSource = 'sample';
      render();
      break;
    case 'clear-docs':
      if (pack.docs.length && !confirm('Remove every document from this browser? Student links you already shared keep working.')) return;
      updatePack({ v: 1, title: 'My course', docs: [] }, 'Started an empty course. Add documents above.');
      break;
    case 'make-link':
      void encodePack(pack).then((frag) => {
        shareLink = `${location.origin}${location.pathname}#${frag}`;
        shareMsg =
          shareLink.length > LONG_LINK
            ? `This link is long (${shareLink.length.toLocaleString('en-US')} characters). Some email clients and learning management systems cut long links; if students report a damaged link, host the JSON pack instead (below).`
            : '';
        render();
      });
      break;
    case 'copy-link':
      void navigator.clipboard?.writeText(shareLink).then(
        () => {
          shareMsg = 'Copied.';
          render();
        },
        () => {
          (document.getElementById('share') as HTMLInputElement | null)?.select();
        },
      );
      break;
    case 'download-pack':
      download(`${slug(pack.title)}.pack.json`, JSON.stringify(pack, null, 2), 'application/json');
      break;
    case 'report-md':
      download(`gaps-${slug(pack.title)}.md`, reportMarkdown(gapReport(mergeEntries(log, imported)), pack.title), 'text/markdown');
      break;
    case 'report-csv':
      download(`questions-${slug(pack.title)}.csv`, logCsv(mergeEntries(log, imported)), 'text/csv');
      break;
    case 'clear-log':
      if (!confirm("Delete this browser's question log for this course?")) return;
      log = [];
      save(logKey(), log);
      render();
      break;
  }
}

app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.id === 'files' && el.files?.length) void addFiles(el.files);
  else if (el.id === 'logs' && el.files?.length) void importLogs(el.files);
  else if (el.dataset.title !== undefined) {
    const i = Number(el.dataset.title);
    const next = { ...pack, docs: pack.docs.map((d, k) => (k === i ? { ...d, title: el.value.trim() || d.title } : d)) };
    updatePack(next);
  } else if (el.id === 'pack-title') updatePack({ ...pack, title: el.value.trim() || pack.title });
});

app.addEventListener('dragover', (ev) => {
  const drop = (ev.target as HTMLElement).closest('#drop');
  if (!drop) return;
  ev.preventDefault();
  drop.classList.add('over');
});
app.addEventListener('dragleave', (ev) => (ev.target as HTMLElement).closest('#drop')?.classList.remove('over'));
app.addEventListener('drop', (ev) => {
  const drop = (ev.target as HTMLElement).closest('#drop');
  if (!drop) return;
  ev.preventDefault();
  drop.classList.remove('over');
  if (ev.dataTransfer?.files.length) void addFiles(ev.dataTransfer.files);
});

// ------------------------------------------------------------------ start

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fromHash = await decodePack(location.hash);
  if (fromHash && 'pack' in fromHash) setPack(fromHash.pack, 'link');
  else {
    const remote = params.get('pack');
    let loaded = false;
    if (remote && /^https:\/\//.test(remote)) {
      try {
        const res = await fetch(remote);
        const v = validatePack(await res.json());
        if ('pack' in v) {
          setPack(v.pack, 'link');
          loaded = true;
        } else teachStatus(`Could not open the course pack: ${v.error}`, 'bad');
      } catch {
        teachStatus('Could not download the course pack from that address (it must allow cross-origin reads).', 'bad');
      }
    }
    if (!loaded) {
      const stored = load<unknown>(PACK_KEY);
      const v = stored ? validatePack(stored) : null;
      if (v && 'pack' in v) setPack(v.pack, packId(v.pack) === packId(SAMPLE_PACK) ? 'sample' : 'local');
      else setPack(SAMPLE_PACK, 'sample');
    }
    if (fromHash && 'error' in fromHash) {
      teachStatus(fromHash.error, 'bad');
      tab = 'teach';
    }
  }
  render();
  const q = params.get('q');
  if (q) ask(q);
}

void start();
