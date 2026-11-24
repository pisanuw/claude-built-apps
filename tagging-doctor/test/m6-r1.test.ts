// @vitest-environment jsdom
/**
 * Milestone 6, review round 1 (review-m6-r1.md) and the launch review's L-1:
 * each fix beside the case the old code got right.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckerClause, CheckerJob } from '../src/core/compile';
import { listFigures } from '../src/core/figures';
import { openProject } from '../src/core/project';
import { buildReport, regionHtml, reportHtml } from '../src/core/report';
import { countOf, courseReportBody, courseRows } from '../src/core/saved';
import { scanDocument } from '../src/core/scan';
import { staleNote } from '../src/lib/alts';
import { memoryStorage, setByokKey } from '../src/lib/llm';
import { comparisonView } from '../src/ui/compare';
import { jobResult } from '../src/ui/compile';
import { forgetRestored, mountFixes, newFixesState } from '../src/ui/fixes';
import { tableRegion } from '../src/ui/table-region';
import { doc, file, idx, NOW, settle, zip } from './alt-page';

afterEach(() => {
  document.body.innerHTML = '';
});

const UA2 = 'ISO 14289-2:2024';
const clause = (c: string, n: number): CheckerClause => ({ specification: UA2, clause: c, testNumber: 1, failedChecks: n, description: `veraPDF says ${c}` });
function job(failed: number, clauses: CheckerClause[]): CheckerJob {
  return {
    id: 'a'.repeat(32), status: 'done', mainFile: 'main.tex', createdAt: '2026-11-24T12:00:00.000Z', startedAt: '2026-11-24T12:00:01.000Z', finishedAt: '2026-11-24T12:00:30.000Z',
    result: { pages: 3, seconds: 29, warnings: 0, runs: 2, bibliography: null, validation: { profile: 'PDF/UA-2 + Tagged PDF validation profile', verapdfVersion: 'veraPDF 1.30.4', compliant: false, failedRules: clauses.length, failedChecks: failed, clauses }, validationError: null },
    failure: null, logTail: [], pdf: true, expiresAt: null, note: null,
  } as CheckerJob;
}
/** Each region box under `root`: its role, name and tab stop. */
const regions = (root: ParentNode) => [...root.querySelectorAll('.table-wrap')].map((d) => [d.getAttribute('role'), d.getAttribute('aria-label'), d.getAttribute('tabindex')]);
const holder = (els: HTMLElement[]) => {
  const d = document.createElement('div');
  d.append(...els);
  return d;
};

describe('R6.1-1, L-1: every table the page builds sits in a named, focusable region', () => {
  it('the compare: both tables; the corner cell of "Side by side" has a name', () => {
    const d = holder(comparisonView(job(4786, [clause('8.2.2', 4668), clause('8.8', 118)]), job(181, [clause('8.2.2', 181)])));
    expect(regions(d)).toEqual([
      ['region', 'Side by side', '0'],
      ['region', 'Failed checks by clause', '0'],
    ]);
    const corner = d.querySelector('table.compare thead th') as HTMLElement;
    expect(corner.textContent).toBe('Measure');
    expect(corner.querySelector('.visually-hidden')).not.toBeNull();
    expect([...d.querySelectorAll('table.compare thead th')].map((t) => t.textContent)).toEqual(['Measure', 'Original', 'Patched copy']);
  });

  it('the compile result', () => {
    const d = holder(jobResult(job(4786, [clause('8.2.2', 4668), clause('8.8', 118)])));
    expect(regions(d)).toEqual([['region', 'Failures by clause, most frequent first', '0']]);
  });

  it('"Scan all": the one-row-per-document table', async () => {
    const { mountApp } = await import('../src/ui/app');
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {} });
    const d = (t: string) => `\\documentclass{article}\\title{${t}}\\begin{document}x\\end{document}`;
    await app.handleFile(file('course.zip', zip({ 'a/main.tex': d('a'), 'b/main.tex': d('b') })));
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Scan all') as HTMLButtonElement).click();
    await settle();
    expect(regions(root.querySelector('#all') as HTMLElement)).toEqual([['region', 'One row per document', '0']]);
  });

  it('kept: the helper names a region by its caption, or by the name it is given; with neither, "Table"', () => {
    const t = document.createElement('table');
    t.innerHTML = '<caption>Your courses</caption>';
    expect(tableRegion(t).getAttribute('aria-label')).toBe('Your courses');
    expect(tableRegion(document.createElement('table'), 'Projects').getAttribute('aria-label')).toBe('Projects');
    expect(tableRegion(document.createElement('table')).getAttribute('aria-label')).toBe('Table');
  });
});

describe('R6.1-2: the downloaded report\'s tables are in regions too; headings wrap', () => {
  it('the figures table and the documents table; the name is escaped', () => {
    const p = openProject('c.zip', zip({ 'a/main.tex': doc('\\includegraphics{x.png}'), 'b/main.tex': doc('y'), 'a/x.png': 'x' }));
    const html = reportHtml(buildReport(p.name, p.leftOut, p.warnings, [scanDocument(p, 'a/main.tex', idx), scanDocument(p, 'b/main.tex', idx)], idx.data, NOW));
    const d = document.createElement('div');
    d.innerHTML = /<main>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
    expect(regions(d)).toEqual([
      ['region', 'Documents', '0'],
      ['region', 'Figures without alt text', '0'],
    ]);
    expect(html).toMatch(/p,h1,h2,h3,h4\{overflow-wrap:anywhere\}/);
    expect(regionHtml('a"<b', '<table></table>')).toBe('<div class="table-wrap" role="region" aria-label="a&quot;&lt;b" tabindex="0"><table></table></div>');
  });
});

describe('R6.1-3: the shown row\'s button is named with its label', () => {
  it('"Shown below: details of <file>" on the shown one, "Show details of <file>" on the others, also after another is shown', async () => {
    const { mountApp } = await import('../src/ui/app');
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {} });
    const d = (t: string) => `\\documentclass{article}\\title{${t}}\\begin{document}x\\end{document}`;
    await app.handleFile(file('course.zip', zip({ 'a/main.tex': d('a'), 'b/main.tex': d('b') })));
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Scan all') as HTMLButtonElement).click();
    await settle();
    const names = () => [...root.querySelectorAll('button[data-show]')].map((b) => [b.textContent, b.getAttribute('aria-label')]);
    const shownFirst = names().find(([t]) => t === 'Shown below');
    expect(shownFirst?.[1]).toMatch(/^Shown below: details of [ab]\/main\.tex$/);
    const other = (root.querySelector('button[data-show]:not([aria-label^="Shown"])') as HTMLButtonElement).dataset.show as string;
    (root.querySelector(`button[data-show="${other}"]`) as HTMLButtonElement).click();
    await settle();
    expect(names()).toContainEqual(['Shown below', `Shown below: details of ${other}`]);
    expect(names().filter(([t]) => t === 'Show details').every(([, n]) => (n ?? '').startsWith('Show details of '))).toBe(true);
  });
});

describe('R6.1-8: a count in a saved row is a number', () => {
  it('a string or markup in a count gives 0, and the report has no element from it; kept: numbers and digit strings', () => {
    expect([countOf(3), countOf('4'), countOf(0), countOf('<img src=x onerror=alert(1)>'), countOf(-2), countOf(null), countOf(2.7)]).toEqual([3, 4, 0, 0, 0, 0, 2]);
    const bad = '<img src=x onerror="alert(1)">';
    const rows = courseRows(
      [{ id: 'p', name: 'hw1', main_file: 'main.tex' } as never],
      new Map([['p', { id: 's', project_id: 'p', created_at: NOW.toISOString(), summary: { verdict: '1 blocker found', blockers: bad, warnings: bad } } as never]]),
    );
    expect([rows[0].blockers, rows[0].warnings]).toEqual([0, 0]);
    const body = courseReportBody({ course: { name: 'C', term: null }, generatedAt: NOW.toISOString(), rows, blockers: [], data: { from: null, to: null, source: 's', commit: 'c0ffee0', retrieved: 'r', licence: 'l' } } as never);
    const d = document.createElement('div');
    d.innerHTML = body;
    expect(d.querySelector('img')).toBeNull();
  });
});

describe('R6.1-6 (a): a draft\'s own note does not repeat under the stale note', () => {
  it('three drafts of a figure whose image cannot be read: the stale note once, the draft\'s note once; a change of person takes the stale note only', async () => {
    const pr = openProject('t.zip', zipSync({ 'main.tex': strToU8(doc('\\includegraphics{f.png}')), 'f.png': new Uint8Array([1, 2, 3]) }));
    const storage = memoryStorage();
    setByokKey('k', storage);
    document.body.innerHTML = '<div id="p"></div>';
    const el = document.getElementById('p') as HTMLElement;
    const state = newFixesState();
    const reply = { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'A draft' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    mountFixes(el, { project: pr, scan: scanDocument(pr, 'main.tex', idx), state, downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false, storage, draft: { ask: (async () => reply) as never }, imageDeps: { decode: async () => Promise.reject(new Error('bad')) } as never } });
    const [id] = [...state.alts.keys()];
    const note = staleNote({ text: 'Old words', decision: 'approved' });
    Object.assign(state.alts.get(id) ?? {}, { note });
    state.restored.set(id, { text: '', status: 'none', note });
    for (let i = 0; i < 3; i++) {
      (el.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
      await settle();
    }
    const got = state.alts.get(id)?.note ?? '';
    expect(got.startsWith(note)).toBe(true);
    expect(got.split(note).length - 1).toBe(1);
    // The draft's own note (this file is not an image the browser reads) appears once.
    expect(got.split('The draft is from the text only.').length - 1).toBe(1);
    // A change of person takes the stale note and leaves the draft's own.
    forgetRestored(state);
    expect(state.alts.get(id)).toMatchObject({ text: 'A draft', note: got.slice(note.length).trim() });
    expect(state.alts.get(id)?.note).toMatch(/The draft is from the text only\.$/);
    expect(state.alts.get(id)?.stale).toBeUndefined();
  });
});

describe('R6.1-6 (b): a file the figure list reads is read once', () => {
  it('forty pictures that read one data file: one read; kept: a file the scan read is the scan\'s copy', () => {
    const pics = Array.from({ length: 40 }, () => '\\begin{tikzpicture}\\begin{axis}\\addplot table {d.csv};\\end{axis}\\end{tikzpicture}').join('\n');
    const p = openProject('t.zip', zip({ 'main.tex': doc(pics), 'd.csv': '1,2\n' }));
    const scan = scanDocument(p, 'main.tex', idx);
    let reads = 0;
    const entries = (p as unknown as { entries: Map<string, { read: () => Uint8Array }> }).entries;
    const e = entries.get('d.csv') as { read: () => Uint8Array };
    const read = e.read.bind(e);
    e.read = () => {
      reads++;
      return read();
    };
    listFigures(p, scan);
    listFigures(p, scan);
    expect(reads).toBe(1);
    expect(p.peekText('main.tex')).toBe(p.text('main.tex'));
  });
});

describe('R6.1-5: the compare\'s script arriving after the fix panel is drawn', () => {
  it('an open fix panel is drawn again with it, signed in; kept: closed, nothing is drawn; the choices stay', async () => {
    const { mountApp } = await import('../src/ui/app');
    const { CourseStore, MemoryDb } = await import('../src/lib/store');
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const account = { mountSignIn: () => () => {}, onUser: (cb: (u: { id: string }) => void) => cb({ id: 'u1' }), store: () => new CourseStore(new MemoryDb('u1', () => NOW)), token: async () => 't' };
    const checker = { base: 'https://checker.invalid', fetch: (async () => new Response('{}')) as typeof fetch, sleep: async () => {}, now: () => 0 };
    const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account, compile: { checker, downloadBlob: () => {} } });
    let calls = 0;
    const mod = {
      compareSlot: () => {
        calls++;
        return (slot: HTMLElement) => {
          slot.append(Object.assign(document.createElement('p'), { className: 'stand-in-compare' }));
          return { cancel: () => {} };
        };
      },
    };
    await app.handleFile(file('lab.zip', zip({ 'main.tex': doc('x') })));
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Suggest fixes') as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector('.stand-in-compare')).toBeNull();
    // The person's choice on a card stays when the panel is drawn again with the compare.
    (root.querySelector('[data-fix="unicode-math"] [data-role="accept"], [data-fix="unicode-math"] button') as HTMLButtonElement).click();
    const pressed = () => root.querySelector('[data-fix="unicode-math"]')?.className;
    const before = pressed();
    app.setCompare(mod as never);
    expect(calls).toBe(1);
    expect(root.querySelector('.stand-in-compare')).not.toBeNull();
    expect(pressed()).toBe(before);
    // Kept: with no fix panel open, nothing is drawn.
    document.body.innerHTML = '<div id="app"></div>';
    const other = mountApp(document.getElementById('app') as HTMLElement, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account, compile: { checker, downloadBlob: () => {} } });
    other.setCompare(mod as never);
    expect(calls).toBe(1);
  });
});
