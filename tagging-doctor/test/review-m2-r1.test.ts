// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openProject } from '../src/core/project';
import { courseReportBody, courseReportHtml, reportData, shortDate, shortDateTime, storedFinding, toStoredScan, type StoredScan } from '../src/core/saved';
import { cutAt, scanDocument, wellFormed, type DocumentScan } from '../src/core/scan';
import { CourseStore, MemoryDb, SaveError, SCAN_SUMMARY_COLUMNS, SupabaseDb, type TableClient, type TableQuery } from '../src/lib/store';
import { mountApp, PENDING_KEY, routeId, type Account, type AppDeps, type DroppedFile } from '../src/ui/app';
import { plainError } from '../src/ui/pages';
import { statusIndex, text, zipFixture } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-20T12:00:00Z');
/** True when no half character is in the string (String#isWellFormed, without the ES2024 lib). */
const whole = (s: string | undefined) => wellFormed(s ?? '') === (s ?? '');
const scanTex = (src: string): DocumentScan => scanDocument(openProject('main.tex', text(src)), 'main.tex', idx);
const byPkg = (s: DocumentScan, pkg: string) => s.findings.filter((f) => f.package === pkg && f.rule === 'package-status');
const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
async function settle(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/** An account whose events the test sends, counting mounted and unmounted controls. */
function account(store: CourseStore, user: { id: string } | null) {
  const cbs: ((u: { id: string } | null) => void)[] = [];
  let mounted = 0;
  const a: Account = {
    mountSignIn: (el) => {
      mounted++;
      el.replaceChildren(Object.assign(document.createElement('button'), { textContent: 'Sign in with Google' }));
      return () => {
        mounted--;
        el.replaceChildren();
      };
    },
    onUser: (cb) => {
      cbs.push(cb);
      cb(user);
    },
    store: () => store,
  };
  return { a, send: (u: { id: string } | null) => cbs.forEach((cb) => cb(u)), mounted: () => mounted };
}

function setup(acc: Account, over: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const session = new Map<string, string>();
  const deps: AppDeps = {
    loadStatus: async () => idx,
    now: () => NOW,
    session: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => void session.set(k, v), removeItem: (k) => void session.delete(k) },
    download: () => {},
    pause: async () => {},
    account: acc,
    confirm: () => true,
    ...over,
  };
  const app = mountApp(root, deps);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const button = (label: string, scope: ParentNode = root) =>
    ([...scope.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const input = (sel: string, value: string) => {
    const i = q<HTMLInputElement | HTMLSelectElement>(sel);
    i.value = value;
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input'));
  };
  return { root, app, session, q, button, input };
}

const stored = (blockers: string[]): StoredScan => ({
  data_as_of: '2026-11-19',
  summary: { mainFile: 'm.tex', verdict: 'x', blockers: blockers.length, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 } },
  findings: blockers.map((b) => ({ path: 'm.tex', line: 1, rule: 'package-status' as const, severity: 'blocker' as const, package: b, kind: 'package' as const })),
});

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('R2.1-1: the banner after a sign-in that reloaded opens a dialog outside it', () => {
  it('puts the dialog after the hidden banner, not inside it, and a later event does not remove it', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const acc = account(store, { id: 'u1' });
    const items = [{ name: 'hw1', mainFile: 'main.tex', scan: stored([]) }];
    const t = setup(acc.a, { session: { getItem: (k) => (k === PENDING_KEY ? JSON.stringify({ mode: 'one', items }) : null), setItem: () => {}, removeItem: () => {} } });
    t.button('Save to a course').click();
    await settle();
    expect(t.q('#pending').hidden).toBe(true);
    expect(t.q('#save').closest('[hidden]')).toBeNull();
    expect(t.q('#save-h').textContent).toBe('Save to a course');
    acc.send({ id: 'u1' });
    await settle();
    expect(t.q('#save')?.closest('[hidden]')).toBeNull();
    expect(t.q('#save-h').textContent).toBe('Save to a course');
  });
});

describe('R2.1-2: the same person again redraws nothing', () => {
  it('keeps what was typed, the saved line, and the busy Save button', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const acc = account(store, { id: 'u1' });
    const t = setup(acc.a);
    await t.app.handleFile(file('hw1.zip', zipFixture('blockers')));
    t.button('Save').click();
    await settle();
    t.input('#save-course-name', 'Calculus');
    acc.send({ id: 'u1' });
    await settle();
    expect(t.q<HTMLInputElement>('#save-course-name').value).toBe('Calculus');
    // During a save: the same Save button stays busy, so one click saves once.
    let release: () => void = () => {};
    const real = store.save.bind(store);
    const spy = vi.spyOn(store, 'save').mockImplementation((c, i) => new Promise((r) => (release = () => r(real(c, i)))));
    t.button('Save', t.q('#save')).click();
    await settle();
    acc.send({ id: 'u1' });
    await settle();
    t.button('Save', t.q('#save')).click();
    release();
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.q('#save .save-status').textContent).toMatch(/^Saved “hw1” to Calculus\./);
    acc.send({ id: 'u1' });
    await settle();
    expect(t.q('#save .save-status').textContent).toMatch(/^Saved “hw1” to Calculus\./);
  });

  it('redraws the page for another person (the "Switch to" case), with their courses', async () => {
    const db1 = new CourseStore(new MemoryDb('u1', () => NOW));
    const db2 = new CourseStore(new MemoryDb('u2', () => NOW));
    await db1.createCourse('Mine', null);
    let current = db1;
    const acc = account(db1, { id: 'u1' });
    acc.a.store = () => current;
    const t = setup(acc.a);
    await t.app.route('#/courses');
    expect(t.q('#page tbody').textContent).toContain('Mine');
    current = db2;
    acc.send({ id: 'u2' });
    await settle();
    expect(t.q('#page tbody')).toBeNull();
    expect(t.q('#page .empty')).toBeTruthy();
  });
});

describe('R2.1-3: a \\begin{document} inside a definition is not the body', () => {
  it.each([
    '\\documentclass{article}\n\\newenvironment{doc}{\\begin{document}}{\\end{document}}\n\\usepackage{tabu}\n\\begin{doc}Hello\\end{doc}\n',
    '\\documentclass{article}\n\\newcommand{\\bd}{\\begin{document}}\\newcommand{\\ed}{\\end{document}}\n\\usepackage{tabu}\n\\bd Hello\\ed\n',
  ])('keeps the preamble of %#', (src) => {
    const s = scanTex(src);
    expect(byPkg(s, 'tabu')).toHaveLength(1);
    expect(s.summary.verdict).toBe('1 blocker found');
  });

  it('still cuts at the first \\end{document} after a top-level \\begin{document} with an unclosed brace', () => {
    const s = scanTex('\\documentclass{article}\\title{x}\n\\begin{document}\n{\\small text\n\\end{document}\n\\usepackage{tabu}\n');
    expect(byPkg(s, 'tabu')).toEqual([]);
  });
});

describe('R2.1-4: excerpts and saved strings are well formed', () => {
  it('cuts neither at the start nor at the end inside a character', () => {
    const s = scanTex(`\\documentclass{article}\n${'x'.repeat(30)}\\usepackage{tabu} ${'😀'.repeat(200)}\n\\begin{document}x\\end{document}`);
    const ex = toStoredScan(s, '2026-11-19').findings.find((f) => f.package === 'tabu')!.excerpt!;
    expect(whole(ex)).toBe(true);
    expect(ex.length).toBeLessThanOrEqual(200);
    const long = scanTex(`\\documentclass{article}\n${'😀'.repeat(100)}\\usepackage{tabu}\n\\begin{document}x\\end{document}`);
    const ex2 = byPkg(long, 'tabu')[0].excerpt!;
    expect(whole(ex2)).toBe(true);
    expect(ex2).toContain('\\usepackage{tabu}');
  });

  it('drops NUL and half characters from what is saved', () => {
    expect(wellFormed('a\u0000b\ud83dc\ude00d😀')).toBe('abcd😀');
    expect(cutAt('ab😀', 3)).toBe('ab');
    expect(cutAt('ab😀', 4)).toBe('ab😀');
    const f = storedFinding({ severity: 'warning', rule: 'no-title', path: 'a\u0000.tex', line: 1, message: 'm', fix: null, package: 'p\ud83d', excerpt: `\\title \u0000x\ude00 ${'😀'.repeat(150)}` });
    expect(f.path).toBe('a.tex');
    expect(f.package).toBe('p');
    expect(whole(f.excerpt)).toBe(true);
    expect(f.excerpt).not.toContain('\u0000');
    expect(f.excerpt?.length).toBeLessThanOrEqual(200);
  });
});

describe('R2.1-5: a save that fails part way', () => {
  it('removes a project it made for a scan that failed, and Save again saves only the rest', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    const items = ['a.tex', 'b.tex', 'c.tex'].map((n) => ({ name: n, mainFile: n, scan: stored([]) }));
    const insert = db.insert.bind(db);
    let scans = 0;
    vi.spyOn(db, 'insert').mockImplementation(async (table, row) => {
      if (table === 'scans' && ++scans === 2) throw new Error('scans: network down');
      return insert(table, row);
    });
    const err = await store.save(c.id, items).catch((e) => e);
    expect(err).toBeInstanceOf(SaveError);
    expect((err as SaveError).saved.map((r) => r.project.name)).toEqual(['a.tex']);
    expect((await store.projects(c.id)).map((p) => p.name)).toEqual(['a.tex']);
  });

  it('the dialog keeps what was saved and retries the rest', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const acc = account(store, { id: 'u1' });
    const t = setup(acc.a);
    await t.app.handleFile(file('course.zip', zipFixture('course')));
    t.button('Scan all').click();
    t.button('Save all to a course').click();
    await settle();
    t.input('#save-course-name', 'C');
    const insert = db.insert.bind(db);
    let scans = 0;
    vi.spyOn(db, 'insert').mockImplementation(async (table, row) => {
      if (table === 'scans' && ++scans === 2) throw new Error('scans: network down');
      return insert(table, row);
    });
    t.button('Save 4 projects', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toBe('Could not save: scans: network down. 1 of 4 saved; Save again saves the rest.');
    t.button('Save 4 projects', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toMatch(/^Saved 4 projects to C\./);
    const projects = await store.projects((await store.courses())[0].id);
    expect(projects).toHaveLength(4);
    const counts = await Promise.all(projects.map(async (p) => (await store.scansOf([p.id])).length));
    expect(counts).toEqual([1, 1, 1, 1]);
  });
});

describe('R2.1-6: the course pages read summaries, and reads go on to the count', () => {
  it('the course page asks for no findings, and the report for the latest scans\' findings only', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    for (let i = 0; i < 3; i++) await store.save(c.id, [{ name: 'p', mainFile: 'p.tex', scan: stored(i ? [] : ['tabu']) }]);
    const spy = vi.spyOn(db, 'select');
    const t = setup(account(store, { id: 'u1' }).a);
    await t.app.route(`#/course/${c.id}`);
    const scanReads = spy.mock.calls.filter((call) => call[0] === 'scans');
    expect(scanReads.map((call) => call[2])).toEqual([SCAN_SUMMARY_COLUMNS]);
    spy.mockClear();
    await t.app.route(`#/course/${c.id}/report`);
    const reads = spy.mock.calls.filter((call) => call[0] === 'scans');
    expect(reads[0][2]).toBe(SCAN_SUMMARY_COLUMNS);
    expect((reads[1][1] as { id: string[] }).id).toHaveLength(1);
  });

  it('reads on until the total count, whatever page size the API gives', async () => {
    const calls: unknown[][] = [];
    let served = 0;
    const q: TableQuery = {
      eq: () => q,
      in: () => q,
      order: () => q,
      range: (...a) => (calls.push(a), q),
      select: () => q,
      single: () => q,
      then: (ok, bad) => {
        // A project whose API limit is 100 rows.
        const n = Math.min(100, 250 - served);
        served += n;
        return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: served - n + i })), error: null, count: 250 }).then(ok, bad);
      },
    };
    const client: TableClient = { from: () => ({ select: () => q, insert: () => q, update: () => q, delete: () => q }) };
    const rows = await new SupabaseDb(client).select('scans');
    expect(rows).toHaveLength(250);
    expect(calls).toEqual([[0, 999], [100, 1099], [200, 1199]]);
  });

  it('updates a row through the client', async () => {
    const seen: unknown[] = [];
    const q = { eq: (...a: unknown[]) => (seen.push(a), q), then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) } as unknown as TableQuery;
    const client = { from: () => ({ update: (f: unknown) => (seen.push(f), q) }) } as unknown as TableClient;
    await new SupabaseDb(client).update('projects', 'p1', { main_file: 'b.tex' });
    expect(seen).toEqual([{ main_file: 'b.tex' }, ['id', 'p1']]);
    const bad = { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: { message: 'denied' } }) }) }) } as unknown as TableClient;
    await expect(new SupabaseDb(bad).update('projects', 'p1', {})).rejects.toThrow('projects: denied');
  });
});

describe('R2.1-8: dates in the person\'s zone on the pages, UTC in the download', () => {
  it('formats in the zone given, or the person\'s own', () => {
    expect(shortDate('2026-11-21T07:30:00Z', 'America/Los_Angeles')).toBe('20 Nov 2026');
    expect(shortDateTime('2026-11-21T07:30:00Z', 'America/Los_Angeles')).toMatch(/^20 Nov 2026, 23:30 (PST|GMT-8)$/);
    expect(shortDate('2026-11-21T07:30:00Z', 'UTC')).toBe('21 Nov 2026');
  });

  it('the report page uses the person\'s zone; the download says UTC', () => {
    const r = {
      course: { name: 'C', term: null },
      generatedAt: NOW.toISOString(),
      rows: [{ project: 'p', mainFile: 'p.tex', verdict: 'x', blockers: 0, warnings: 0, scannedAt: '2026-11-21T07:30:00Z' }],
      blockers: [],
      data: reportData([{ data_as_of: '2026-11-19' }], idx.data),
    };
    expect(courseReportHtml(r)).toContain('<th scope="col">Latest scan (UTC)</th>');
    expect(courseReportHtml(r)).toContain('<td>21 Nov 2026</td>');
    const page = courseReportBody(r, 2, 'local');
    expect(page).toContain('<th scope="col">Latest scan</th>');
    expect(page).toContain(`<td>${shortDate('2026-11-21T07:30:00Z')}</td>`);
  });
});

describe('R2.1-9: seven small things', () => {
  it('a malformed or non-UUID id shows "Not found"', async () => {
    expect(routeId('%E0%A4%A')).toBeNull();
    expect(routeId('abc')).toBeNull();
    expect(routeId('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe('3F2504E0-4F89-41D3-9A0C-0305E82C3301');
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const spy = vi.spyOn(store, 'course');
    const t = setup(account(store, { id: 'u1' }).a);
    for (const h of ['#/course/%E0%A4%A', '#/course/abc', '#/course/abc/report', '#/project/%zz']) {
      await t.app.route(h);
      expect(t.q('#page').hidden, h).toBe(false);
      expect(t.q('#page-h').textContent, h).toBe('Not found');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('"Show details" keeps an open "Save all" dialog and what was typed; another document closes a single save', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const t = setup(account(store, { id: 'u1' }).a);
    await t.app.handleFile(file('course.zip', zipFixture('course')));
    t.button('Scan all').click();
    t.button('Save all to a course').click();
    await settle();
    t.input('#save-course-name', 'Kept');
    (t.q('[data-show="hw3/hw3.tex"]') as HTMLButtonElement).click();
    expect(t.q<HTMLInputElement>('#save-course-name').value).toBe('Kept');
    expect(t.q('#all').contains(t.q('#save'))).toBe(true);
    // A single save of one document closes when another is shown.
    await t.app.handleFile(file('course.zip', zipFixture('course')));
    expect(t.q('#save')).toBeNull();
  });

  it('unmounts the panel\'s sign-in controls each time it closes', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const acc = account(store, null);
    const t = setup(acc.a);
    await t.app.handleFile(file('hw1.zip', zipFixture('blockers')));
    expect(acc.mounted()).toBe(1);
    for (let i = 0; i < 5; i++) {
      t.button('Save').click();
      t.button('Cancel', t.q('#save')).click();
    }
    expect(acc.mounted()).toBe(1);
    t.button('Save').click();
    acc.send({ id: 'u1' });
    await settle();
    expect(acc.mounted()).toBe(1);
  });

  it('says the database\'s two errors in plain words', () => {
    expect(plainError(new Error('projects: insert or update on table "projects" violates foreign key constraint "x"'))).toBe(
      'the course or project is no longer there, perhaps deleted in another tab. Choose the course again',
    );
    expect(plainError(new Error('projects: duplicate key value violates unique constraint "y"'))).toMatch(/^a project of that name was saved at the same moment/);
    expect(plainError(new TypeError('Failed to fetch'))).toBe('the connection was lost; check it');
    expect(plainError('odd')).toBe('odd');
  });

  it('names the page region by the heading it shows', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const c = await store.createCourse('C', null);
    await store.save(c.id, [{ name: 'p', mainFile: 'p.tex', scan: stored([]) }]);
    const t = setup(account(store, { id: 'u1' }).a);
    await t.app.route(`#/course/${c.id}/report`);
    expect(t.q('#page').getAttribute('aria-labelledby')).toBe('course-report-h');
    expect(t.q('#course-report-h')).toBeTruthy();
    await t.app.route('#/courses');
    expect(t.q('#page').getAttribute('aria-labelledby')).toBe('page-h');
  });

  it('a project takes the main file of its latest scan', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const c = await store.createCourse('C', null);
    await store.save(c.id, [{ name: 'p', mainFile: 'old.tex', scan: stored([]) }]);
    const [r] = await store.save(c.id, [{ name: 'p', mainFile: 'new.tex', scan: stored([]) }]);
    expect(r.project.main_file).toBe('new.tex');
    expect((await store.projects(c.id))[0].main_file).toBe('new.tex');
    const [again] = await store.save(c.id, [{ name: 'p', mainFile: 'new.tex', scan: stored([]) }]);
    expect(again.project.main_file).toBe('new.tex');
  });
});
