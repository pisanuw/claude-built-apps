// @vitest-environment jsdom
/**
 * Milestone 3b: the minor findings of milestone 2 carried here (R2.2-1 to
 * R2.2-3, R2.C-2, R2.C-3). Each test fails without its fix.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { leftOutDocumentsLines, openProject } from '../src/core/project';
import { courseReportBody } from '../src/core/saved';
import { scanDocument, wellFormed, type DocumentScan } from '../src/core/scan';
import { CourseStore, MemoryDb, type CourseSummary } from '../src/lib/store';
import { mountApp, type Account, type AppDeps, type DroppedFile } from '../src/ui/app';
import { courseReport } from '../src/ui/pages';
import { statusIndex, text } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-22T12:00:00Z');
const whole = (s: string | undefined) => wellFormed(s ?? '') === (s ?? '');
const scanTex = (src: string): DocumentScan => scanDocument(openProject('main.tex', text(src)), 'main.tex', idx);
const byPkg = (s: DocumentScan, pkg: string) => s.findings.filter((f) => f.package === pkg && f.rule === 'package-status');
const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
const SCAN = { data_as_of: '2026-11-19', summary: { mainFile: 'a.tex', verdict: 'No known blockers', blockers: 0, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 } }, findings: [] };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('R2.2-1: an unclosed { before \\begin{document} keeps the end-of-document cut', () => {
  it('cuts at the \\end{document} of a body that never closes', () => {
    const s = scanTex('\\documentclass{article}\n{\\small\n\\begin{document}\nhello\n\\end{document}\nold notes\n\\usepackage{tabu}\n\\includegraphics{old.png}\n');
    expect(byPkg(s, 'tabu')).toEqual([]);
    expect(s.summary.verdict).toBe('No known blockers');
    expect(s.figures.images).toBe(0);
  });

  it('still forgets a \\begin{document} inside a definition, before and after a stray brace', () => {
    expect(byPkg(scanTex('\\documentclass{article}\n\\newenvironment{doc}{\\begin{document}}{\\end{document}}\n\\usepackage{tabu}\n\\begin{doc}Hello\\end{doc}\n'), 'tabu')).toHaveLength(1);
    // The definition's begin closes; the real body after a stray brace then cuts.
    const s = scanTex('\\documentclass{article}\n\\newcommand{\\bd}{\\begin{document}}\n{\\small\n\\begin{document}\nx\n\\end{document}\n\\usepackage{tabu}\n');
    expect(byPkg(s, 'tabu')).toEqual([]);
    // A body at depth 0 with an unclosed brace inside, as before (R1.3-2).
    expect(byPkg(scanTex('\\documentclass{article}\\title{x}\n\\begin{document}\n{\\small text\n\\end{document}\n\\usepackage{tabu}\n'), 'tabu')).toEqual([]);
  });
});

describe('R2.2-2: a failed main_file update does not undo the save', () => {
  it('reports the scan saved, and a retry is not needed', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    await store.save(c.id, [{ name: 'hw1', mainFile: 'a.tex', scan: SCAN }]);
    const update = db.update.bind(db);
    let fail = true;
    db.update = async (...a) => {
      if (fail) {
        fail = false;
        throw new Error('Failed to fetch');
      }
      return update(...a);
    };
    const [r] = await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: SCAN }]);
    expect(r.created).toBe(false);
    expect(r.project.main_file).toBe('a.tex');
    expect(await db.select('scans')).toHaveLength(2);
    // The next save updates it.
    const [r2] = await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: SCAN }]);
    expect(r2.project.main_file).toBe('main.tex');
  });
});

describe('R2.2-3: the small things', () => {
  it('(a) a courses load that ends after the dialog was drawn again draws nothing', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    let release: (v: CourseSummary[]) => void = () => {};
    store.courses = () => new Promise((r) => (release = r));
    const cbs: ((u: { id: string } | null) => void)[] = [];
    const account: Account = {
      mountSignIn: (el) => {
        el.replaceChildren(Object.assign(document.createElement('button'), { textContent: 'Sign in with Google' }));
        return () => el.replaceChildren();
      },
      onUser: (cb) => {
        cbs.push(cb);
        cb({ id: 'u1' });
      },
      store: () => store,
    };
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const deps: AppDeps = { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account };
    const app = mountApp(root, deps);
    await app.handleFile(file('p.tex', text('\\documentclass{article}\\begin{document}x\\end{document}')));
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Save') as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector('#save-h')?.textContent).toBe('Save to a course');
    for (const cb of cbs) cb(null);
    expect(root.querySelector('#save-h')?.textContent).toBe('Sign in to save');
    release([]);
    await settle();
    expect(root.querySelector('#save-h')?.textContent).toBe('Sign in to save');
    expect(root.querySelector('#save form')).toBeNull();
  });

  it('(b) an excerpt of exactly 200 units does not end, nor start, on half a character', () => {
    const s = scanTex(`\\documentclass{article}\n  \\usepackage{tabu}${'a'.repeat(182)}${'😀'.repeat(20)}\n\\begin{document}x\\end{document}`);
    const ex = byPkg(s, 'tabu')[0].excerpt;
    expect(whole(ex)).toBe(true);
    expect((ex ?? '').length).toBeLessThanOrEqual(200);
    // The start guard: the cut 60 units before the command lands on the second half of an emoji.
    const t = scanTex(`\\documentclass{article}\n${'😀'.repeat(100)}a\\usepackage{tabu}\n\\begin{document}x\\end{document}`);
    const ex2 = byPkg(t, 'tabu')[0].excerpt;
    expect(whole(ex2)).toBe(true);
    expect(ex2).toContain('\\usepackage{tabu}');
  });

  it('(c) a saved project\'s name and main file hold no NUL', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const saved: { name: string; mainFile: string }[][] = [];
    const save = store.save.bind(store);
    store.save = async (id, items) => {
      saved.push(items.map((i) => ({ name: i.name, mainFile: i.mainFile })));
      return save(id, items);
    };
    const account: Account = { mountSignIn: () => () => {}, onUser: (cb) => cb({ id: 'u1' }), store: () => store };
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account });
    const zip = zipSync({ 'hw\u0000a/main.tex': strToU8('\\documentclass{article}\\begin{document}x\\end{document}'), 'hw\u0000a/other.tex': strToU8('\\documentclass{article}\\begin{document}y\\end{document}') });
    await app.handleFile(file('p.zip', zip));
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Scan all') as HTMLButtonElement).click();
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Save all to a course') as HTMLButtonElement).click();
    await settle();
    (root.querySelector('#save-course-name') as HTMLInputElement).value = 'C';
    root.querySelector('#save form')?.dispatchEvent(new Event('submit'));
    await settle(20);
    expect(saved.flat().length).toBe(2);
    for (const i of saved.flat()) {
      expect(i.name).not.toContain('\u0000');
      expect(i.mainFile).not.toContain('\u0000');
    }
    expect((await db.select<{ name: string }>('projects')).map((p) => p.name).sort()).toEqual(['hwa/main.tex', 'hwa/other.tex']);
  });

  it('(e) the report page writes times in the person\'s zone, not UTC', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    await store.save(c.id, [{ name: 'a', mainFile: 'a.tex', scan: SCAN }, { name: 'b', mainFile: 'b.tex', scan: SCAN }]);
    const r = await courseReport(store, c.id, NOW, idx.data);
    expect(r).not.toBeNull();
    expect(courseReportBody(r as NonNullable<typeof r>, 2, 'local')).toContain('<th scope="col">Latest scan</th>');
    expect(courseReportBody(r as NonNullable<typeof r>, 2, 'UTC')).toContain('Latest scan (UTC)');
    // The page itself asks for the person's zone.
    const account: Account = { mountSignIn: () => () => {}, onUser: (cb) => cb({ id: 'u1' }), store: () => store };
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account });
    await app.route(`#/course/${c.id}/report`);
    await settle();
    const heads = [...root.querySelectorAll('.course-report th')].map((t) => t.textContent);
    expect(heads).toContain('Latest scan');
    expect(heads).not.toContain('Latest scan (UTC)');
  });

  it('(f) the course report reads the course row once', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    let reads = 0;
    const course = store.course.bind(store);
    store.course = async (id) => {
      reads++;
      return course(id);
    };
    const data = idx.data;
    await courseReport(store, c.id, NOW, data, c);
    expect(reads).toBe(0);
    await courseReport(store, c.id, NOW, data);
    expect(reads).toBe(1);
  });
});

describe('R2.C-2 and R2.C-3: the no-document sentences', () => {
  it('counts every file of a folder that held a .tex or .ltx file (any case), and none for a folder without one', () => {
    const zip = zipSync({
      'grades/a.csv': strToU8('a'),
      'roster/B.TEX': strToU8('x'),
      'Calculus-for-students/week1.ltx': strToU8('x'),
      'Calculus-for-students/notes.txt': strToU8('x'),
    });
    expect(leftOutDocumentsLines(openProject('p.zip', zip))).toEqual([
      '1 file in roster/ was left out as student records; see the warning below to have it read.',
      '2 files in Calculus-for-students/ were left out as student records; see the warning below to have them read.',
    ]);
  });

  it('past three folders, says it in one sentence', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 12; i++) files[`students-${String(i).padStart(2, '0')}/hw.tex`] = strToU8('x');
    files['students-01/data.csv'] = strToU8('x');
    const lines = leftOutDocumentsLines(openProject('p.zip', zipSync(files)));
    expect(lines).toEqual(['13 files in 12 folders (students-01/, students-02/, students-03/ and 9 more) were left out as student records; see the warnings below to have them read.']);
  });
});
