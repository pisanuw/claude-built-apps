// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import googleG from '../src/lib/google-g-light.svg?raw';
import { CourseStore, MemoryDb } from '../src/lib/store';
import { mountApp, PENDING_KEY, type Account, type AppDeps, type DroppedFile } from '../src/ui/app';
import { KEEP_POINTS, NO_COURSES, NO_PROJECTS, SIGN_IN_FOR_COURSES } from '../src/ui/pages';
import { previewAccount, previewAuthClient, PREVIEW_USER } from '../src/ui/preview-account';
import { rawZip, statusIndex, zipFixture } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-20T12:00:00Z');

function file(name: string, bytes: Uint8Array): DroppedFile {
  return { name, arrayBuffer: async () => bytes.slice().buffer };
}

/** Lets promises and timers settle. */
async function settle(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/** An account whose sign-in state the test sets, over a given store. */
function fakeAccount(store: CourseStore, signedIn: boolean) {
  const cbs: ((u: { id: string } | null) => void)[] = [];
  let user = signedIn ? { id: 'u1' } : null;
  const account: Account = {
    mountSignIn: (el) => {
      el.replaceChildren(Object.assign(document.createElement('button'), { textContent: 'Sign in with Google', className: 'fake-google' }));
      return () => el.replaceChildren();
    },
    onUser: (cb) => {
      cbs.push(cb);
      cb(user);
    },
    store: () => store,
  };
  return {
    account,
    set(u: { id: string } | null) {
      user = u;
      for (const cb of cbs) cb(u);
    },
  };
}

function setup(over: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const session = new Map<string, string>();
  const downloads: { name: string; type: string; content: string }[] = [];
  const deps: AppDeps = {
    loadStatus: async () => idx,
    now: () => NOW,
    session: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => void session.set(k, v), removeItem: (k) => void session.delete(k) },
    download: (name, type, content) => void downloads.push({ name, type, content }),
    pause: async () => {},
    account: previewAccount(() => NOW),
    confirm: () => true,
    print: vi.fn(),
    ...over,
  };
  const app = mountApp(root, deps);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const qa = (sel: string) => [...root.querySelectorAll(sel)] as HTMLElement[];
  const button = (label: string, scope: ParentNode = root) =>
    ([...scope.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
  const input = (sel: string, value: string) => {
    const i = q<HTMLInputElement | HTMLSelectElement>(sel);
    i.value = value;
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input'));
  };
  return { root, app, deps, session, downloads, q, qa, button, input };
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});
afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('AC-16: two sign-in buttons, and the scan without signing in', () => {
  it('shows "Sign in with Google" with Google\'s G, unmodified, and "Magic link", at the right of the top bar', async () => {
    const { q, qa } = setup();
    await settle();
    const bar = q('.top-bar');
    const signin = bar.querySelector('#signin') as HTMLElement;
    expect(signin.classList.contains('hw-signin')).toBe(true);
    expect(bar.lastElementChild).toBe(signin);
    const buttons = qa('#signin > button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Sign in with Google', 'Magic link']);
    const shown = buttons[0].querySelector('.hw-signin-google-logo')?.innerHTML ?? '';
    const paths = [...googleG.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(3);
    for (const d of paths) expect(shown).toContain(d);
    // Round and icon-only below 640 px, as on UpvoteMe (the template's one @media block).
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/@media \(max-width: 639\.98px\)/);
    expect(q('#nav-courses').hidden).toBe(true);
  });

  it('scans without signing in, and "Save" opens sign-in, keeping the save for after it', async () => {
    const { app, q, button, session } = setup();
    await settle();
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    expect(q('#result-h').textContent).toBe('2 blockers found');
    button('Save').click();
    await settle();
    const panel = q('#save');
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('#save-h')?.textContent).toBe('Sign in to save');
    expect(document.activeElement).toBe(panel.querySelector('#save-h'));
    expect([...panel.querySelectorAll('.save-signin > button')].map((b) => b.textContent?.trim())).toEqual(['Sign in with Google', 'Magic link']);
    expect(panel.querySelector('a[href="#/what-we-keep"]')).toBeTruthy();
    const pending = JSON.parse(session.get(PENDING_KEY) as string);
    expect(pending.mode).toBe('one');
    expect(pending.items[0]).toMatchObject({ name: 'blockers', mainFile: 'main.tex' });
    // Cancel drops it.
    button('Cancel', panel).click();
    expect(panel.hidden).toBe(true);
    expect(session.has(PENDING_KEY)).toBe(false);
  });

  it('signing in from the save panel turns it into the save dialog', async () => {
    const { app, q, button, session } = setup();
    await settle();
    await app.handleFile(file('blockers.zip', zipFixture('blockers')));
    button('Save').click();
    await settle();
    button('Sign in with Google', q('#save')).click();
    await settle();
    expect(q('#save-h').textContent).toBe('Save to a course');
    // The focus stays in the panel (acceptance m2's note).
    expect(document.activeElement).toBe(q('#save-h'));
    expect(q('#nav-courses').hidden).toBe(false);
    expect(session.has(PENDING_KEY)).toBe(false);
    // The top bar shows the person now.
    expect(q('#signin').textContent).toContain(PREVIEW_USER.email);
  });
});

async function signedInWithScan(name = 'blockers', bytes = zipFixture('blockers')) {
  const t = setup();
  await settle();
  t.button('Sign in with Google', t.q('#signin')).click();
  await settle();
  await t.app.handleFile(file(`${name}.zip`, bytes));
  return t;
}

describe('AC-17: save to a new or existing course, and find it after a reload', () => {
  it('saves to a new course with a project name, then to the same course again', async () => {
    const t = await signedInWithScan();
    t.button('Save').click();
    await settle();
    const panel = t.q('#save');
    expect(t.q<HTMLSelectElement>('#save-course').value).toBe('');
    expect(t.q<HTMLInputElement>('#save-project').value).toBe('blockers');
    // No name for the new course: asked for one.
    t.button('Save', panel).click();
    await settle();
    expect(panel.querySelector('.save-status')?.textContent).toBe('Give the new course a name.');
    t.input('#save-course-name', 'Calculus I');
    t.input('#save-term', 'Fall 2026');
    t.input('#save-project', '');
    t.button('Save', panel).click();
    await settle();
    expect(panel.querySelector('.save-status')?.textContent).toBe('Give the project a name.');
    t.input('#save-project', 'Homework 1');
    t.button('Save', panel).click();
    await settle();
    expect(panel.querySelector('.save-status')?.textContent).toBe('Saved “Homework 1” to Calculus I, Fall 2026. Open Calculus I, Fall 2026');
    expect(t.q<HTMLSelectElement>('#save-course').selectedOptions[0].textContent).toBe('Calculus I, Fall 2026');

    // AC-21: a new version saved under the same name shows what changed.
    await t.app.handleFile(file('blockers.zip', rawZip([{ name: 'main.tex', data: '\\documentclass{article}\\usepackage{caption}\\usepackage{minted}\\title{x}\\begin{document}\\end{document}' }])));
    t.button('Save').click();
    await settle();
    expect(t.q<HTMLSelectElement>('#save-course').selectedOptions[0].textContent).toBe('Calculus I, Fall 2026');
    t.input('#save-project', 'Homework 1');
    await settle();
    expect(t.q('#save-hint').textContent).toBe('This saves a new scan of the project “Homework 1”, and shows what changed since its previous scan.');
    t.button('Save', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toContain('Saved a new scan of “Homework 1” in Calculus I, Fall 2026. 1 blocker fixed and 1 new since the previous scan.');

    // My courses, the course, the project's history.
    await t.app.route('#/courses');
    expect(t.q('#scan-view').hidden).toBe(true);
    expect(t.q('#page-h').textContent).toBe('My courses');
    expect(t.qa('#page tbody tr').map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))).toEqual([['Calculus I, Fall 2026', '1', '20 Nov 2026']]);
    const courseHref = (t.q('#page tbody a') as HTMLAnchorElement).getAttribute('href') as string;
    await t.app.route(courseHref);
    expect(t.q('#page-h').textContent).toBe('Calculus I, Fall 2026');
    // AC-19: latest verdict, blockers, warnings and date.
    expect(t.qa('#page tbody tr').map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))).toEqual([['Homework 1', '2 blockers found', '2', '3', '20 Nov 2026']]);
    await t.app.route((t.q('#page tbody a') as HTMLAnchorElement).getAttribute('href') as string);
    expect(t.q('#page-h').textContent).toBe('Homework 1');
    expect(t.qa('#page tbody tr').map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['20 Nov 2026, 12:00 UTC', '2 blockers found', '2', '3', '1 fixed, 1 new'],
      ['20 Nov 2026, 12:00 UTC', '2 blockers found', '2', '1', 'first scan'],
    ]);
    expect(t.q('#page').textContent).toContain('No checks yet.');
    expect(t.q('#page').textContent).toContain('No saved alt texts.');
    // Back to the scan: it is still there.
    await t.app.route('#/');
    expect(t.q('#scan-view').hidden).toBe(false);
    expect(t.q('#result-h').textContent).toBe('2 blockers found');
  });

  it('"Save all to a course" saves one project per main file, named by its path, in one action', async () => {
    const t = await signedInWithScan('course', zipFixture('course'));
    t.button('Scan all').click();
    t.button('Save all to a course').click();
    await settle();
    expect(t.q('#save-h').textContent).toBe('Save all to a course');
    expect(t.q('#save').textContent).toContain('named by its path: hw1/hw1.tex, hw2/hw2.tex, hw3/hw3.tex, notes/notes.tex');
    t.input('#save-course-name', 'CS 142');
    t.button('Save 4 projects', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toMatch(/^Saved 4 projects to CS 142\./);
    // Again: each project gets a second scan with its delta.
    t.button('Save 4 projects', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toContain('hw2/hw2.tex: 0 blockers fixed and 0 new since the previous scan.');
    await t.app.route('#/courses');
    expect(t.qa('#page tbody td')[1].textContent).toBe('4');
  });

  it('reports a failed save and lets the person try again', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const f = fakeAccount(store, true);
    const t = setup({ account: f.account });
    await t.app.handleFile(file('blockers.zip', zipFixture('blockers')));
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('network down'));
    t.button('Save').click();
    await settle();
    t.input('#save-course-name', 'C');
    t.button('Save', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toBe('Could not save: network down. Try again.');
    t.button('Save', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toMatch(/^Saved “blockers” to C\./);
  });

  it('shows the error and a retry when the courses do not load in the dialog', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.handleFile(file('blockers.zip', zipFixture('blockers')));
    const spy = vi.spyOn(store, 'courses').mockRejectedValueOnce(new Error('offline'));
    t.button('Save').click();
    await settle();
    expect(t.q('#save [role="alert"]').textContent).toBe('Could not load your courses: offline');
    t.button('Retry', t.q('#save')).click();
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(t.q('#save-course')).toBeTruthy();
    t.button('Cancel', t.q('#save')).click();
    expect(t.q('#save')).toBeNull();
  });

  it('after a sign-in that reloaded the page, offers the save asked for before it', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const items = [{ name: 'hw1', mainFile: 'main.tex', scan: { data_as_of: '2026-11-19', summary: { mainFile: 'main.tex', verdict: 'No known blockers', blockers: 0, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 } }, findings: [] } }];
    document.body.innerHTML = '';
    const t1 = setup({ account: fakeAccount(store, true).account, session: { getItem: (k) => (k === PENDING_KEY ? JSON.stringify({ mode: 'one', items }) : null), setItem: () => {}, removeItem: () => {} } });
    expect(t1.q('#pending').hidden).toBe(false);
    expect(t1.q('#pending').textContent).toContain('You scanned hw1 before signing in. Save it to a course?');
    t1.button('Save to a course').click();
    await settle();
    expect(t1.q('#pending').hidden).toBe(true);
    expect(t1.q<HTMLInputElement>('#save-project').value).toBe('hw1');
    t1.input('#save-course-name', 'Algebra');
    t1.button('Save', t1.q('#save')).click();
    await settle();
    expect((await store.courses())[0]).toMatchObject({ name: 'Algebra', projects: 1 });

    // Discard drops it.
    const kept = new Map([[PENDING_KEY, JSON.stringify({ mode: 'all', items: [...items, { ...items[0], name: 'hw2' }] })]]);
    const t2 = setup({ account: fakeAccount(store, true).account, session: { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v), removeItem: (k) => void kept.delete(k) } });
    expect(t2.q('#pending').textContent).toContain('Save them to a course?');
    expect(t2.button('Save all to a course')).toBeTruthy();
    t2.button('Discard').click();
    expect(kept.has(PENDING_KEY)).toBe(false);
    expect(t2.q('#pending').hidden).toBe(true);
  });

  it('ignores a pending save it cannot read, and storage that throws', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const t = setup({ account: fakeAccount(store, true).account, session: { getItem: () => '{bad', setItem: () => {}, removeItem: () => {} } });
    expect(t.q('#pending').hidden).toBe(true);
    const f = fakeAccount(store, false);
    const boom = () => {
      throw new Error('blocked');
    };
    const t2 = setup({ account: f.account, session: { getItem: boom, setItem: boom, removeItem: boom } });
    await t2.app.handleFile(file('blockers.zip', zipFixture('blockers')));
    t2.button('Save').click();
    expect(t2.q('#save-h').textContent).toBe('Sign in to save');
    t2.button('Cancel', t2.q('#save')).click();
    f.set({ id: 'u1' });
    expect(t2.q('#pending').hidden).toBe(true);
  });
});

describe('AC-18: My courses, empty, loading and failing', () => {
  it('says how to start when there are none, and shows a loading line first', async () => {
    const t = setup();
    await settle();
    t.button('Sign in with Google', t.q('#signin')).click();
    await settle();
    const going = t.app.route('#/courses');
    expect(t.q('#page .loading').textContent).toBe('Loading your courses…');
    await going;
    expect(t.q('#page .empty').textContent).toBe(NO_COURSES);
    expect(t.q('#page a[href="#/"]').textContent).toBe('Scan a project');
  });

  it('shows the error and a retry', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const spy = vi.spyOn(store, 'courses').mockRejectedValueOnce(new Error('courses: permission denied'));
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.route('#/courses');
    expect(t.q('#page [role="alert"]').textContent).toBe('Could not load your courses: courses: permission denied');
    t.button('Retry', t.q('#page')).click();
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(t.q('#page .empty').textContent).toBe(NO_COURSES);
  });

  it('asks a signed-out visitor to sign in, and redraws on sign-in and sign-out', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const f = fakeAccount(store, false);
    const t = setup({ account: f.account });
    await t.app.route('#/courses');
    expect(t.q('#page .signed-out').textContent).toBe(SIGN_IN_FOR_COURSES);
    history.replaceState(null, '', '#/courses');
    f.set({ id: 'u1' });
    await settle();
    expect(t.q('#page .empty').textContent).toBe(NO_COURSES);
    f.set(null);
    await settle();
    expect(t.q('#page .signed-out')).toBeTruthy();
    expect(t.q('#nav-courses').hidden).toBe(true);
  });

  it('drops a page that a newer route replaced while it loaded', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    let release: () => void = () => {};
    vi.spyOn(store, 'courses').mockImplementationOnce(() => new Promise((r) => (release = () => r([]))));
    const t = setup({ account: fakeAccount(store, true).account });
    const first = t.app.route('#/courses');
    await t.app.route('#/what-we-keep');
    release();
    await first;
    expect(t.q('#page-h').textContent).toBe('What we keep');
  });
});

async function courseWithTwo() {
  const store = new CourseStore(new MemoryDb('u1', () => NOW));
  const c = await store.createCourse('Stats 201', 'Fall 2026');
  const scan = (blockers: string[]) => ({
    data_as_of: '2026-11-19',
    summary: { mainFile: 'm.tex', verdict: blockers.length ? `${blockers.length} blockers found` : 'No known blockers', blockers: blockers.length, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 } },
    findings: blockers.map((b) => ({ path: 'm.tex', line: 1, rule: 'package-status' as const, severity: 'blocker' as const, package: b, kind: 'package' as const })),
  });
  const saved = await store.save(c.id, [
    { name: 'hw1', mainFile: 'hw1.tex', scan: scan(['tabu', 'caption']) },
    { name: 'hw2', mainFile: 'hw2.tex', scan: scan(['caption']) },
  ]);
  return { store, course: c, saved };
}

describe('AC-19, AC-20 and AC-25: the course page, its report, and deleting', () => {
  it('opens a printable course report with one row per project and blockers by projects affected', async () => {
    const { store, course } = await courseWithTwo();
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.route(`#/course/${course.id}`);
    expect(t.q('#page a.button-link[href$="/report"]').textContent).toBe('Course report');
    await t.app.route(`#/course/${course.id}/report`);
    expect(document.body.classList.contains('printing-report')).toBe(true);
    expect(t.q('#page h2').textContent).toBe('Course report: Stats 201, Fall 2026');
    expect(t.q('.top-bar')).toBeTruthy();
    expect(t.q('#page .no-print')).toBeTruthy();
    const tables = t.qa('#page .course-report table');
    expect([...tables[0].querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent)).toEqual(['hw1', 'hw2']);
    expect([...tables[1].querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['caption (package)', '2', 'hw1, hw2'],
      ['tabu (package)', '1', 'hw1'],
    ]);
    t.button('Print').click();
    expect(t.deps.print).toHaveBeenCalled();
    t.button('Download HTML').click();
    expect(t.downloads[0].name).toBe('tagging-doctor-course-Stats-201.html');
    expect(t.downloads[0].content).toMatch(/^<!doctype html>[\s\S]*<h1 id="course-report-h" tabindex="-1">Course report: Stats 201, Fall 2026<\/h1>/);
    // The print stylesheet hides the bar and the buttons.
    await t.app.route('#/');
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });

  it('deletes a project with its scans, then the course', async () => {
    const { store, course, saved } = await courseWithTwo();
    const confirm = vi.fn((_m: string) => true);
    const t = setup({ account: fakeAccount(store, true).account, confirm });
    await t.app.route(`#/project/${saved[0].project.id}`);
    t.button('Delete this project').click();
    await settle();
    expect(confirm.mock.calls[0][0]).toBe('Delete hw1 and its scan? This cannot be undone.');
    expect(location.hash).toBe(`#/course/${course.id}`);
    expect(await store.scansOf([saved[0].project.id])).toEqual([]);
    await t.app.route(`#/course/${course.id}`);
    expect(t.qa('#page tbody tr')).toHaveLength(1);
    t.button('Delete this course').click();
    await settle();
    expect(confirm.mock.calls[1][0]).toBe('Delete Stats 201, Fall 2026, its project and all their scans? This cannot be undone.');
    expect(location.hash).toBe('#/courses');
    expect(await store.courses()).toEqual([]);
  });

  it('does nothing when the person says no, and says when a delete fails', async () => {
    const { store, course, saved } = await courseWithTwo();
    const t = setup({ account: fakeAccount(store, true).account, confirm: () => false });
    await t.app.route(`#/course/${course.id}`);
    t.button('Delete this course').click();
    await t.app.route(`#/project/${saved[1].project.id}`);
    t.button('Delete this project').click();
    await settle();
    expect((await store.courses())[0].projects).toBe(2);
    const t2 = setup({ account: fakeAccount(store, true).account, confirm: () => true });
    vi.spyOn(store, 'deleteProject').mockRejectedValueOnce(new Error('denied'));
    vi.spyOn(store, 'deleteCourse').mockRejectedValueOnce(new Error('denied'));
    await t2.app.route(`#/project/${saved[1].project.id}`);
    t2.button('Delete this project').click();
    await settle();
    expect(t2.q('#page [role="alert"]').textContent).toBe(' Could not delete: denied');
    await t2.app.route(`#/course/${course.id}`);
    t2.button('Delete this course').click();
    await settle();
    expect(t2.q('#page [role="alert"]').textContent).toBe(' Could not delete: denied');
  });

  it('says so for a course or project that is gone, and for a course with no projects', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const t = setup({ account: fakeAccount(store, true).account });
    for (const h of ['#/course/nope', '#/course/nope/report', '#/project/nope']) {
      await t.app.route(h);
      expect(t.q('#page-h').textContent, h).toBe('Not found');
    }
    const c = await store.createCourse('Empty', null);
    await t.app.route(`#/course/${c.id}`);
    expect(t.q('#page .empty').textContent).toBe(NO_PROJECTS);
    expect(t.q('#page a.button-link[href$="/report"]')).toBeNull();
    expect(t.q('#page a[href="#/"]').textContent).toBe('Add a project');
  });

  it('lists saved checks and alt texts in the history when there are some', async () => {
    const db = new MemoryDb('u1', () => NOW);
    const store = new CourseStore(db);
    const c = await store.createCourse('C', null);
    const [r] = await store.save(c.id, [{ name: 'p', mainFile: 'p.tex', scan: { data_as_of: '2026-11-19', summary: { mainFile: 'p.tex', verdict: 'No known blockers', blockers: 0, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 } }, findings: [] } }]);
    for (let i = 0; i < 2; i++) await db.insert('jobs', { project_id: r.project.id, scan_id: r.scan.id, kind: 'check', status: 'done' });
    await db.insert('alt_texts', { project_id: r.project.id, figure_path: 'a.png', text: 't', decision: 'approved' });
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.route(`#/project/${r.project.id}`);
    // AC-35: a table of the checks, each with its scan, kind and result.
    const rows = [...t.q('#page').querySelectorAll('table')].find((x) => x.querySelector('caption')?.textContent === 'Checks, newest first')?.querySelectorAll('tbody tr') ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('original');
    expect(rows[0].textContent).toContain('Compiled.');
    expect(t.q('#page').textContent).toContain('1 alt text saved.');
  });
});

describe('AC-24: Export my data', () => {
  it('downloads one JSON file of all the person\'s courses, projects, scans, jobs and alt texts', async () => {
    const { store } = await courseWithTwo();
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.route('#/courses');
    t.button('Export my data').click();
    await settle();
    expect(t.downloads[0].name).toBe('tagging-doctor-my-data.json');
    const data = JSON.parse(t.downloads[0].content);
    expect(Object.keys(data)).toEqual(['format', 'exportedAt', 'app', 'courses', 'projects', 'scans', 'jobs', 'alt_texts']);
    expect(data.courses).toHaveLength(1);
    expect(data.projects).toHaveLength(2);
    expect(data.scans).toHaveLength(2);
  });

  it('says when the export fails', async () => {
    const { store } = await courseWithTwo();
    vi.spyOn(store, 'exportAll').mockRejectedValueOnce(new Error('offline'));
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.route('#/courses');
    t.button('Export my data').click();
    await settle();
    expect(t.q('#page [role="alert"]').textContent).toBe(' Could not export: offline');
  });
});

describe('AC-26: "What we keep"', () => {
  it('is linked from the app\'s own content and from the save dialog, and says each thing the criterion lists', async () => {
    const t = setup();
    expect(t.q('.about a[href="#/what-we-keep"]').textContent).toBe('What we keep');
    expect(t.q('nav.pages a[href="#/what-we-keep"]')).toBeTruthy();
    await t.app.route('#/what-we-keep');
    expect(t.q('#page-h').textContent).toBe('What we keep');
    const text = t.q('#page').textContent as string;
    for (const p of KEEP_POINTS) expect(text).toContain(p);
    for (const must of [
      'Your sources are never stored.',
      'The checker deletes a job’s files within 30 minutes.',
      'Saved reports hold excerpts only',
      '“Export my data”',
      '“Delete my account”',
      'sends the image and up to 1,200 characters of the text around it to Anthropic: directly, with your own key, or through HintWise’s gateway',
      'The gateway records when each person first and last used the app.',
      'Visits are counted without cookies.',
      'sends the project’s files to the HintWise checker, which runs on Render in the US (region oregon)',
      'Upload only materials you wrote or may change.',
      'the line “Nothing is uploaded” on the scan page speaks of the scan only',
    ]) {
      expect(text).toContain(must);
    }
  });
});

describe('the preview account', () => {
  it('signs in and out, and a sign-in link signs in too', async () => {
    const client = previewAuthClient();
    const seen: (string | null)[] = [];
    client.auth.onAuthStateChange((_e, s) => seen.push(s?.user.id ?? null));
    await client.auth.verifyOtp({ token_hash: 'x', type: 'email' });
    await client.auth.signOut();
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
    expect(seen).toEqual([PREVIEW_USER.id, null]);
    const sub = client.auth.onAuthStateChange(() => {});
    sub.data.subscription.unsubscribe();
  });

  it('sends no email: "Magic link" signs the preview person in', async () => {
    const t = setup();
    await settle();
    t.button('Magic link', t.q('#signin')).click();
    const email = t.q<HTMLInputElement>('#signin input[type="email"]');
    email.value = 'a@example.com';
    (email.form as HTMLFormElement).requestSubmit();
    await settle();
    expect(t.q('#nav-courses').hidden).toBe(false);
  });
});

describe('AC-73 and AC-74 (CR-4): a file the browser downloaded again saves to its project', () => {
  async function withHw1() {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const c = await store.createCourse('Calc', null);
    await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: { data_as_of: '2026-11-19', summary: { mainFile: 'main.tex', verdict: '1 blockers found', blockers: 1, warnings: 0, unknown: 0, ok: 0, notes: [], figures: { images: 0, imagesWithoutAlt: 0, tikz: 0, tikzWithoutAlt: 0 } }, findings: [{ path: 'main.tex', line: 1, rule: 'package-status', severity: 'blocker', package: 'tabu', kind: 'package' }] } }]);
    const t = setup({ account: fakeAccount(store, true).account });
    return { store, c, t };
  }

  it('"hw1 (1).zip" defaults to hw1, says so, and adds a scan to it', async () => {
    const { store, c, t } = await withHw1();
    await t.app.handleFile(file('hw1 (1).zip', zipFixture('blockers')));
    t.button('Save').click();
    await settle();
    expect(t.q<HTMLInputElement>('#save-project').value).toBe('hw1');
    expect(t.q('#save-hint').textContent).toBe('This saves a new scan of the project “hw1”, and shows what changed since its previous scan.');
    t.button('Save', t.q('#save')).click();
    await settle();
    expect(t.q('#save .save-status').textContent).toContain('Saved a new scan of “hw1” in Calc. 0 blockers fixed and 1 new since the previous scan.');
    expect((await store.projects(c.id)).map((p) => p.name)).toEqual(['hw1']);
  });

  it('keeps the name as it is for a new course, and uses a name the person types', async () => {
    const { store, c, t } = await withHw1();
    await t.app.handleFile(file('hw1(2).zip', zipFixture('blockers')));
    t.button('Save').click();
    await settle();
    expect(t.q<HTMLInputElement>('#save-project').value).toBe('hw1');
    t.input('#save-course', '');
    await settle();
    expect(t.q<HTMLInputElement>('#save-project').value).toBe('hw1(2)');
    t.input('#save-course', c.id);
    await settle();
    expect(t.q<HTMLInputElement>('#save-project').value).toBe('hw1');
    t.input('#save-project', 'other');
    t.input('#save-course', c.id);
    await settle();
    expect(t.q<HTMLInputElement>('#save-project').value).toBe('other');
    t.button('Save', t.q('#save')).click();
    await settle();
    expect((await store.projects(c.id)).map((p) => p.name)).toEqual(['hw1', 'other']);
  });

  it.each(['hw1-v2.zip', 'hw1 final.zip'])('%s keeps its own name', async (name) => {
    const { t } = await withHw1();
    await t.app.handleFile(file(name, zipFixture('blockers')));
    t.button('Save').click();
    await settle();
    expect(t.q<HTMLInputElement>('#save-project').value).toBe(name.replace(/\.zip$/, ''));
    expect(t.q('#save-hint').textContent).toBe('');
  });
});

describe('AC-75 (CR-5): the course report page names its package data', () => {
  it('shows the date, the source and the licence, as the download does', async () => {
    const { store, course } = await courseWithTwo();
    const t = setup({ account: fakeAccount(store, true).account });
    await t.app.route(`#/course/${course.id}/report`);
    const line = t.q('#page .data-line').textContent as string;
    expect(line).toMatch(/^Package data as of 2026-11-19: the LaTeX Project’s tagging status list, .* \(LaTeX Project Public License, version 1\.3c or later\)\.$/);
    t.button('Download HTML').click();
    expect(t.downloads[0].content).toContain(line);
  });
});
