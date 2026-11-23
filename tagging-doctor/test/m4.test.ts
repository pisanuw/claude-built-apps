// @vitest-environment jsdom
/**
 * Milestone 4 on the page: "Suggest fixes" signed in or not (AC-37), the
 * language of the \DocumentMetadata line (AC-38), the patched zip (AC-41),
 * "Needs your attention" (AC-44), and "Compile patched and compare" (AC-42,
 * AC-43) against a stub of the checker, present only when the build turns it
 * on (AC-80). The comparison itself is src/core/compare.ts.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckerClause, CheckerJob } from '../src/core/compile';
import { CHANGE_WORDS, compareJobs, compiledWords, failuresWords, finished, madeItFail, side, trendLine } from '../src/core/compare';
import { metadataLine } from '../src/core/patch';
import { keptToken, type CheckerDeps } from '../src/lib/checker';
import { CourseStore, MemoryDb } from '../src/lib/store';
import { mountApp, type Account, type AppDeps, type DroppedFile } from '../src/ui/app';
import * as compareModule from '../src/ui/compare';
import { NOTICE_KEY } from '../src/ui/compile';
import { statusIndex } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-23T12:00:00Z');
const BASE = 'https://checker.test';
const UA2 = 'ISO 14289-2:2024';
const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
/** jsdom's Blob has no arrayBuffer(). */
const blobBytes = (b: Blob) =>
  new Promise<Uint8Array>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.readAsArrayBuffer(b);
  });
async function settle(n = 40) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
const clause = (c: string, n: number): CheckerClause => ({ specification: UA2, clause: c, testNumber: 1, failedChecks: n, description: `veraPDF says ${c}` });

function job(over: Partial<CheckerJob> = {}): CheckerJob {
  return {
    id: 'a'.repeat(32),
    status: 'done',
    mainFile: 'main.tex',
    createdAt: '2026-11-23T12:00:00.000Z',
    startedAt: '2026-11-23T12:00:01.000Z',
    finishedAt: '2026-11-23T12:00:30.000Z',
    result: {
      pages: 3,
      seconds: 29,
      warnings: 0,
      runs: 2,
      bibliography: null,
      validation: { profile: 'PDF/UA-2 + Tagged PDF validation profile', verapdfVersion: 'veraPDF 1.30.4', compliant: false, failedRules: 3, failedChecks: 4786, clauses: [clause('8.2.2', 4668), clause('8.8', 89), clause('5', 29)] },
      validationError: null,
    },
    failure: null,
    logTail: [],
    pdf: true,
    expiresAt: null,
    note: null,
    ...over,
  };
}
const patchedDone = (over: Partial<CheckerJob> = {}) =>
  job({ result: { pages: 3, seconds: 33, warnings: 0, runs: 2, bibliography: null, validation: { profile: 'PDF/UA-2 + Tagged PDF validation profile', verapdfVersion: 'veraPDF 1.30.4', compliant: false, failedRules: 2, failedChecks: 190, clauses: [clause('8.2.2', 181), clause('8.4.3', 9)] }, validationError: null }, ...over });
const failedRun = (kind = 'compile-error'): CheckerJob =>
  job({ status: 'failed', result: null, pdf: false, failure: { kind, message: 'LuaLaTeX stopped with an error.', error: { file: 'main.tex', line: 3, message: 'Package lwarp Error: \\DocumentMetadata detected' } }, logTail: ['l1', 'l2'] });

/**
 * A stub of the checker: health answers; each POST makes a job whose final
 * state `answer` decides from the zip it was sent (patched when its main
 * file has a \DocumentMetadata line), and a GET shows it running once, then final.
 */
function stub(answer: (patched: boolean, main: string, n: number) => CheckerJob, opts: { realSleep?: boolean } = {}) {
  const posts: { patched: boolean; main: string }[] = [];
  const deletes: string[] = [];
  const gets: string[] = [];
  const jobs = new Map<string, { final: CheckerJob; gets: number }>();
  let clock = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchStub = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url === `${BASE}/api/health`) return json(200, { status: 'ok', compile: true, texlive: 'TeX Live 2026', verapdf: 'veraPDF 1.30.4' });
    if (url.startsWith(`${BASE}/api/jobs?`) && method === 'POST') {
      const z = unzipSync(init.body as Uint8Array);
      const main = strFromU8(z['main.tex'] ?? z[Object.keys(z).find((k) => k.endsWith('main.tex')) as string]);
      const patched = main.includes('\\DocumentMetadata');
      posts.push({ patched, main });
      const id = (posts.length.toString(16) + (patched ? 'b' : 'a').repeat(32)).slice(0, 32);
      jobs.set(id, { final: { ...answer(patched, main, posts.length), id }, gets: 0 });
      return json(202, { ...job({ id, status: 'queued', result: null }), checksLeft: 5 - posts.length });
    }
    const m = /\/api\/jobs\/([0-9a-f]{32})$/.exec(url);
    if (m && method === 'DELETE') {
      deletes.push(m[1]);
      return new Response(null, { status: 204 });
    }
    if (m) {
      gets.push(m[1]);
      const j = jobs.get(m[1]);
      if (!j) return json(404, { error: 'gone' });
      return json(200, j.gets++ ? j.final : { ...j.final, status: 'running', result: null, failure: null });
    }
    return json(404, { error: 'Not found.' });
  };
  const sleep = opts.realSleep ? (ms: number) => new Promise<void>((r) => setTimeout(() => r(void (clock += ms)), 0)) : async (ms: number) => void (clock += ms);
  const deps: CheckerDeps = { base: BASE, fetch: fetchStub as typeof fetch, sleep, now: () => clock, healthTimeoutMs: 20 };
  return { deps, posts, deletes, gets };
}

function page(opts: { signedIn?: boolean; account?: boolean; compare?: boolean; compile?: boolean; checker?: ReturnType<typeof stub>; index?: typeof idx } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const session = new Map<string, string>([[NOTICE_KEY, '1']]);
  const db = new MemoryDb('u1', () => NOW);
  const store = new CourseStore(db);
  const cbs: ((u: { id: string } | null) => void)[] = [];
  let user = opts.signedIn === false ? null : { id: 'u1' };
  const account: Account = {
    mountSignIn: (e) => {
      e.replaceChildren();
      return () => e.replaceChildren();
    },
    onUser: (cb) => {
      cbs.push(cb);
      cb(user);
    },
    store: () => store,
    // As the sign-in library: no token once the person has signed out.
    token: async () => (user ? 'tok' : null),
  };
  const blobs: { name: string; blob: Blob }[] = [];
  const checker = opts.checker ?? stub(() => job());
  const deps: AppDeps = {
    loadStatus: async () => opts.index ?? idx,
    now: () => NOW,
    session: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => void session.set(k, v), removeItem: (k) => void session.delete(k) },
    download: () => {},
    pause: async () => {},
    account: opts.account === false ? undefined : account,
    confirm: () => true,
    compile: opts.compile === false ? undefined : { checker: checker.deps, downloadBlob: (name, blob) => void blobs.push({ name, blob }) },
    compare: opts.compare ? compareModule : undefined,
    downloadBlob: (name, blob) => void blobs.push({ name, blob }),
  };
  const app = mountApp(root, deps);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const button = (label: string | RegExp) =>
    ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => (typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? ''))) as HTMLButtonElement;
  const setUser = (u: { id: string } | null) => {
    user = u;
    for (const cb of cbs) cb(u);
  };
  return { app, root, q, button, blobs, db, store, setUser, checker };
}

const DOC = '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{tabu}\n\\title{Week 1}\n\\begin{document}\nHi $x$.\n\\end{document}\n';
const PROJECT = zipSync({ 'main.tex': strToU8(DOC), 'figs/a.png': new Uint8Array([137, 80, 78, 71]), 'notes.docx': strToU8('word'), 'grades.csv': strToU8('alice,A') });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC-37, AC-38, AC-41, AC-44: Suggest fixes on the page', () => {
  it('is offered signed out, and with no sign-in at all; the cards show what, why, before and after, with Accept and Skip', async () => {
    for (const t of [page({ signedIn: false }), page({ account: false, compile: false })]) {
      await t.app.handleFile(file('week1.zip', PROJECT));
      t.button('Suggest fixes').click();
      const cards = [...t.root.querySelectorAll<HTMLElement>('#fixes li.fix-card')];
      expect(cards.map((c) => c.dataset.fix)).toEqual(['metadata', 'engine', 'unicode-math']);
      const state = (id: string) => t.q(`[data-fix="${id}"] .state`).textContent;
      expect([state('metadata'), state('engine'), state('unicode-math')]).toEqual(['Accepted', 'Accepted', 'Skipped']);
      const meta = t.q('[data-fix="metadata"]');
      expect(meta.querySelector('.what')?.textContent).toMatch(/^What changes: Puts a \\DocumentMetadata line before \\documentclass in main\.tex/);
      expect(meta.querySelector('.why')?.textContent).toMatch(/^Why: This line switches tagging on/);
      expect(meta.querySelector('pre.before')?.textContent).toBe('\\documentclass{article}');
      expect(meta.querySelector('pre.after')?.textContent).toBe(`${metadataLine('en-US')}\n\\documentclass{article}`);
      // Two lines go (R4a.1-9 f).
      expect(t.q('[data-fix="engine"] pre.before').textContent).toBe('\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}');
      expect(t.q('[data-fix="engine"] pre.after').textContent).toBe('(the lines are removed)');
      // No compare without the build flag (AC-80), and nothing was sent anywhere.
      expect(t.button('Compile patched and compare')).toBeUndefined();
      expect(t.checker.posts).toEqual([]);
      expect(t.q('#fixes-h').textContent).toBe('Suggested fixes');
    }
  });

  it('Skip and Accept change what the zip holds; unaccepted fixes change nothing; the original is never changed', async () => {
    const t = page({ signedIn: false });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    const skip = t.q<HTMLButtonElement>('[data-fix="engine"] [data-role="skip"]');
    skip.click();
    expect(t.q('[data-fix="engine"] [data-role="skip"]').getAttribute('aria-pressed')).toBe('true');
    expect(t.q('[data-fix="engine"] .state').textContent).toBe('Skipped');
    t.q<HTMLButtonElement>('[data-fix="unicode-math"] [data-role="accept"]').click();
    t.button('Download patched zip').click();
    const { name, blob } = t.blobs[0];
    expect(name).toBe('week1-patched.zip');
    const z = unzipSync(await blobBytes(blob));
    expect(Object.keys(z).sort()).toEqual(['figs/a.png', 'main.tex', 'notes.docx', 'tagging-doctor.diff']);
    const main = strFromU8(z['main.tex']);
    expect(main).toContain('\\usepackage[utf8]{inputenc}');
    expect(main.startsWith(metadataLine('en-US'))).toBe(true);
    expect(main).toContain('\\usepackage{unicode-math}\n\\begin{document}');
    expect(strFromU8(z['tagging-doctor.diff'])).toContain('+\\usepackage{unicode-math}');
    expect(t.q('#fixes .fixes-status').textContent).toBe('Downloaded the copy with 2 fixes.');
    expect(t.q('#fixes .left-out').textContent).toMatch(/left out/);
    // Every card skipped: the copy is the project as dropped, with the diff saying so.
    for (const id of ['metadata', 'unicode-math']) t.q<HTMLButtonElement>(`[data-fix="${id}"] [data-role="skip"]`).click();
    t.button('Download patched zip').click();
    const z2 = unzipSync(await blobBytes(t.blobs[1].blob));
    expect(strFromU8(z2['main.tex'])).toBe(DOC);
    expect(strFromU8(z2['tagging-doctor.diff'])).toMatch(/No changes/);
    expect(t.q('#fixes .fixes-status').textContent).toBe('Downloaded the copy with no fix: none is accepted.');
  });

  it('takes a language tag for the line, refuses one that is not a tag, and keeps the choices when the panel is drawn again', async () => {
    const t = page({ signedIn: false });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    const input = t.q<HTMLInputElement>('#fix-language');
    expect(input.value).toBe('en-US');
    input.value = 'de-CH';
    input.dispatchEvent(new Event('change'));
    expect(t.q('[data-fix="metadata"] pre.after').textContent?.startsWith(metadataLine('de-CH'))).toBe(true);
    const again = t.q<HTMLInputElement>('#fix-language');
    again.value = 'not a tag';
    again.dispatchEvent(new Event('change'));
    expect(t.q('[data-fix="metadata"] .error').textContent).toBe(' “not a tag” is not a language tag; the line keeps de-CH.');
    // Signing in draws the panel again with the same choices.
    t.q<HTMLButtonElement>('[data-fix="engine"] [data-role="skip"]').click();
    t.setUser({ id: 'u1' });
    expect(t.q('[data-fix="engine"] .state').textContent).toBe('Skipped');
    expect(t.q('[data-fix="metadata"] pre.after').textContent?.startsWith(metadataLine('de-CH'))).toBe(true);
  });

  it('lists what the patch cannot fix under "Needs your attention", and a new drop or Close removes the panel', async () => {
    const t = page({ signedIn: false });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    expect(t.q('#attention-h').textContent).toMatch(/^Needs your attention \(\d+\)$/);
    const items = [...t.root.querySelectorAll('.attention-item')].map((e) => e.textContent ?? '');
    expect(items.some((x) => x.startsWith('tabu') && x.includes('No tested replacement. Rewrite the tables that use tabu'))).toBe(true);
    t.button('Close').click();
    expect(t.q('#fixes')).toBeNull();
    t.button('Suggest fixes').click();
    expect(t.q('#fixes')).not.toBeNull();
    await t.app.handleFile(file('week1.zip', PROJECT));
    expect(t.q('#fixes')).toBeNull();
  });
});

describe('R4a.1-7: a panel goes with its cancel when its document goes, and stays when the same one is drawn again', () => {
  const TWO = zipSync({ 'a/main.tex': strToU8(DOC), 'b/main.tex': strToU8(DOC.replace('Week 1', 'Week 2')) });
  /** "Show details" in the summary once all are scanned, else "Scan <name>" in the document list. */
  const docButton = (t: ReturnType<typeof page>, name: string) => (t.root.querySelector(`button[data-show="${name}"]`) ?? t.root.querySelector(`button[data-doc="${name}"]`)) as HTMLButtonElement;

  it('"Show details" of another document cancels a running check: one DELETE, and no more polls', async () => {
    const c = stub(() => job({ status: 'running', result: null }), { realSleep: true });
    const t = page({ checker: c });
    await t.app.handleFile(file('two.zip', TWO));
    t.button('Scan all').click();
    t.button('Compile and check').click();
    await settle(20);
    expect(c.posts).toHaveLength(1);
    expect(c.gets.length).toBeGreaterThan(0);
    docButton(t, 'b/main.tex').click();
    await settle();
    expect(t.q('#compile')).toBeNull();
    expect(c.deletes).toHaveLength(1);
    const polled = c.gets.length;
    await settle(40);
    expect(c.gets.length).toBe(polled);
  });

  it('"Show details" of another document removes the fix panel; "Scan all" with the same document keeps it, choices and all', async () => {
    const t = page({ signedIn: false });
    await t.app.handleFile(file('two.zip', TWO));
    docButton(t, 'a/main.tex').click();
    t.button('Suggest fixes').click();
    t.q<HTMLButtonElement>('[data-fix="engine"] [data-role="skip"]').click();
    t.button('Scan all').click();
    expect(t.q('#fixes')).not.toBeNull();
    expect(t.q('#all .downloads + #fixes')).not.toBeNull();
    expect(t.q('[data-fix="engine"] .state').textContent).toBe('Skipped');
    docButton(t, 'b/main.tex').click();
    expect(t.q('#fixes')).toBeNull();
    // Back to a: the panel opens again with a's choices.
    docButton(t, 'a/main.tex').click();
    t.button('Suggest fixes').click();
    expect(t.q('[data-fix="engine"] .state').textContent).toBe('Skipped');
  });

  it('"Scan all" keeps a running check of the same document, with its Cancel', async () => {
    const c = stub(() => job({ status: 'running', result: null }), { realSleep: true });
    const t = page({ checker: c });
    await t.app.handleFile(file('two.zip', TWO));
    docButton(t, 'a/main.tex').click();
    t.button('Compile and check').click();
    await settle(20);
    t.button('Scan all').click();
    await settle(20);
    expect(t.q('#all .downloads + #compile')).not.toBeNull();
    expect(c.deletes).toEqual([]);
    t.button('Cancel').click();
    await settle();
    expect(c.deletes).toHaveLength(1);
  });
});

describe('R4a.2-4 (f), (g): the panels’ order, and a scan that fails', () => {
  const TWO = zipSync({ 'a/main.tex': strToU8(DOC), 'b/main.tex': strToU8(DOC.replace('\\usepackage{tabu}', '\\usepackage{boomzz}')) });
  const scanButton = (t: ReturnType<typeof page>, name: string) => t.root.querySelector(`button[data-doc="${name}"]`) as HTMLButtonElement;
  const order = (t: ReturnType<typeof page>) => [...t.root.querySelectorAll('#compile, #fixes')].map((e) => e.id);

  it('(f) "Scan all" keeps the panels in the order they stood, either way round', async () => {
    for (const first of ['Compile and check', 'Suggest fixes']) {
      const c = stub(() => job({ status: 'running', result: null }), { realSleep: true });
      const t = page({ checker: c });
      await t.app.handleFile(file('two.zip', TWO));
      scanButton(t, 'a/main.tex').click();
      t.button(first).click();
      t.button(first === 'Suggest fixes' ? 'Compile and check' : 'Suggest fixes').click();
      await settle(10);
      const before = order(t);
      expect(before).toEqual(first === 'Suggest fixes' ? ['compile', 'fixes'] : ['fixes', 'compile']);
      t.button('Scan all').click();
      expect(order(t)).toEqual(before);
      t.button('Cancel').click();
      await settle();
    }
  });

  it('(g) a scan that fails cancels a running check of the document shown before', async () => {
    const bad = Object.create(idx) as typeof idx;
    bad.lookup = ((name: string, kind: never) => {
      if (name === 'boomzz') throw new Error('the scan broke');
      return idx.lookup(name, kind);
    }) as typeof idx.lookup;
    const c = stub(() => job({ status: 'running', result: null }), { realSleep: true });
    const t = page({ checker: c, index: bad });
    await t.app.handleFile(file('two.zip', TWO));
    scanButton(t, 'a/main.tex').click();
    t.button('Compile and check').click();
    t.button('Suggest fixes').click();
    await settle(20);
    expect(c.posts).toHaveLength(1);
    scanButton(t, 'b/main.tex').click();
    await settle();
    expect(t.root.textContent).toContain('Something went wrong while reading this file');
    expect(t.q('#compile')).toBeNull();
    expect(t.q('#fixes')).toBeNull();
    expect(c.deletes).toHaveLength(1);
    const polled = c.gets.length;
    await settle(40);
    expect(c.gets.length).toBe(polled);
  });
});

describe('R4a.1-9 f: the card says "line" for one removed line', () => {
  it('one line', async () => {
    const t = page({ signedIn: false });
    await t.app.handleFile(file('one.zip', zipSync({ 'main.tex': strToU8(DOC.replace('\\usepackage[T1]{fontenc}\n', '')) })));
    t.button('Suggest fixes').click();
    expect(t.q('[data-fix="engine"] pre.after').textContent).toBe('(the line is removed)');
  });
});

describe('AC-80: the compare control only with the build flag on', () => {
  it('is absent with the flag off, also signed in with Compile and check on', async () => {
    const t = page({ compare: false });
    await t.app.handleFile(file('week1.zip', PROJECT));
    expect(t.button('Compile and check').hidden).toBe(false);
    t.button('Suggest fixes').click();
    expect(t.button('Compile patched and compare')).toBeUndefined();
    expect(t.q('#fixes .compare-slot').childElementCount).toBe(0);
  });

  it('with the flag on, is shown to a signed-in person only, and comes and goes with sign-in', async () => {
    const t = page({ compare: true, signedIn: false });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    expect(t.button('Compile patched and compare')).toBeUndefined();
    t.setUser({ id: 'u1' });
    expect(t.button('Compile patched and compare')).toBeDefined();
    expect(t.q('#compare-h').textContent).toBe('Compile patched and compare');
    expect(t.q('#fixes .upload-notice').textContent).toMatch(/^Compile sends this project’s files to the HintWise checker/);
    t.setUser(null);
    expect(t.button('Compile patched and compare')).toBeUndefined();
    // Without Compile and check there is no checker to compare on.
    const u = page({ compare: true, compile: false });
    await u.app.handleFile(file('week1.zip', PROJECT));
    u.button('Suggest fixes').click();
    expect(u.button('Compile patched and compare')).toBeUndefined();
  });
});

describe('AC-42: compile patched and compare (stubbed checker)', () => {
  it('compiles the original and the patched copy, and shows them side by side with the change per clause', async () => {
    const c = stub((patched) => (patched ? patchedDone() : job()));
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle();
    expect(c.posts.map((p) => p.patched)).toEqual([false, true]);
    // The patched upload holds the accepted fixes and only the checker's file types.
    expect(c.posts[1].main.startsWith(metadataLine('en-US'))).toBe(true);
    expect(c.posts[1].main).not.toContain('inputenc');
    const cells = (row: number) => [...t.root.querySelectorAll(`table.compare tbody tr:nth-child(${row}) td`)].map((e) => e.textContent);
    expect(cells(1)).toEqual(['Compiled, 3 pages', 'Compiled, 3 pages']);
    expect(cells(3)).toEqual(['4,786 failed checks (3 rules)', '190 failed checks (2 rules)']);
    const rows = [...t.root.querySelectorAll<HTMLElement>('table.compare-clauses tbody tr')].map((r) => [r.dataset.clause, r.dataset.change, r.lastElementChild?.textContent]);
    expect(rows).toEqual([
      ['8.2.2', 'fewer', 'Fewer'],
      ['8.8', 'fixed', 'Fixed'],
      ['5', 'fixed', 'Fixed'],
      ['8.4.3', 'new', 'New'],
    ]);
    expect(t.q('.trend').textContent).toBe('The patched copy has 4,596 fewer failed checks than the original.');
    expect(t.q('.compare-status').textContent).toBe('The comparison is finished. 3 checks left this hour.');
    // Compile again uses the original's check again (S2-13): one more upload, the patched copy only.
    t.button('Compile again').click();
    await settle();
    expect(c.posts.map((p) => p.patched)).toEqual([false, true, true]);
    expect(t.q('.compare-status').textContent).toBe('The comparison is finished (the original’s check from this session was used again). 2 checks left this hour.');
  });

  it('AC-42 (acceptance/m4b.md): when the patched copy does not compile, each clause says it was not checked, not "not known"', async () => {
    const c = stub((patched) => (patched ? failedRun() : job()));
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle();
    const rows = [...t.root.querySelectorAll<HTMLElement>('table.compare-clauses tbody tr')].map((r) => [r.dataset.clause, r.dataset.change, r.lastElementChild?.textContent]);
    expect(rows).toEqual([
      ['8.2.2', 'not-checked', 'Not checked: the patched copy did not compile'],
      ['8.8', 'not-checked', 'Not checked: the patched copy did not compile'],
      ['5', 'not-checked', 'Not checked: the patched copy did not compile'],
    ]);
    expect(t.root.textContent).not.toMatch(/Not known/);
  });

  it('S2-13: uses this scan\'s check from "Compile and check" again, so only the patched copy is sent', async () => {
    const c = stub((patched) => (patched ? patchedDone() : job()));
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Compile and check').click();
    await settle();
    expect(c.posts).toHaveLength(1);
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle();
    expect(c.posts.map((p) => p.patched)).toEqual([false, true]);
    expect(t.root.querySelectorAll('table.compare-clauses tbody tr')).toHaveLength(4);
  });

  it('writes both job rows when the scan is saved: the original\'s as a check, the copy\'s as a patched check (AC-35)', async () => {
    const c = stub((patched) => (patched ? patchedDone() : job()));
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle();
    // Not saved yet: no row. Saving keeps both.
    expect(await t.db.select('jobs')).toEqual([]);
    t.button('Save').click();
    await settle();
    (t.q('#save-course-name') as HTMLInputElement).value = 'CS 1';
    t.q('#save form').dispatchEvent(new Event('submit'));
    await settle(80);
    const rows = await t.db.select<{ kind: string; status: string }>('jobs');
    expect(rows.map((r) => r.kind).sort()).toEqual(['check', 'patched-check']);
    expect(rows.every((r) => r.status === 'done')).toBe(true);
  });

  it('Cancel stops the compare and deletes its job on the checker', async () => {
    // The original never ends, so the compare is still running when Cancel is pressed.
    const c = stub(() => job({ status: 'running', result: null }), { realSleep: true });
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle(20);
    expect(c.posts).toHaveLength(1);
    t.button('Cancel').click();
    await settle();
    expect(t.q('.compare-status').textContent).toBe('Cancelled.');
    expect(c.deletes.length).toBeGreaterThan(0);
    expect(t.button('Compile patched and compare')).toBeDefined();
  });
});

describe('AC-43: turn off a fix and retry', () => {
  it('reruns the copy without the fix, and highlights the fix whose removal made it compile', async () => {
    const c = stub((patched) => (patched ? failedRun() : job()));
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle();
    expect(t.q('.patched-error').textContent).toContain('Package lwarp Error');
    const retry = [...t.root.querySelectorAll<HTMLButtonElement>('.retry-list button')].map((b) => b.textContent);
    expect(retry).toEqual(['Turn off “Add \\DocumentMetadata” and compile again', 'Turn off “Remove inputenc and fontenc” and compile again']);
    // Turning the engine fix off: still fails (both finished), so nothing is highlighted.
    t.q<HTMLButtonElement>('.retry-list button[data-fix="engine"]').click();
    await settle();
    expect(t.q('[data-fix="engine"] .state').textContent).toBe('Skipped');
    expect(t.root.querySelector('.made-it-fail')).toBeNull();
    // The original's check is used again: each retry sends the copy only.
    expect(c.posts.map((p) => p.patched)).toEqual([false, true, true]);
    // Turning the metadata fix off: the copy now has no \DocumentMetadata, so the stub compiles it.
    t.q<HTMLButtonElement>('.retry-list button[data-fix="metadata"]').click();
    await settle();
    expect(c.posts.map((p) => p.patched)).toEqual([false, true, true, false]);
    expect(t.q('.made-it-fail')?.getAttribute('data-fix')).toBe('metadata');
    expect(t.q('[data-fix="metadata"] .highlight').textContent).toMatch(/^Turning this fix off made the patched copy compile/);
  });

  it('highlights nothing when the failing run did not finish (stopped at the limit)', async () => {
    let n = 0;
    const c = stub((patched) => (patched || ++n > 1 ? failedRun(n === 2 ? 'timeout' : 'compile-error') : job()));
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    await settle();
    t.q<HTMLButtonElement>('.retry-list button[data-fix="metadata"]').click();
    await settle();
    expect(t.root.querySelector('.made-it-fail')).toBeNull();
  });
});

describe('the comparison, pure (src/core/compare.ts)', () => {
  it('reads each side, the trend and the change per clause', () => {
    const c = compareJobs(job(), patchedDone());
    expect(c.original).toEqual({ compiled: true, pages: 3, failedChecks: 4786, failedRules: 3, passed: false, profile: 'PDF/UA-2 + Tagged PDF validation profile' });
    expect(c.trend).toBe('fewer');
    expect(c.rows.find((r) => r.clause === '8.2.2')).toMatchObject({ original: 4668, patched: 181, change: 'fewer' });
    expect(c.rows.find((r) => r.clause === '8.2.2')?.words).not.toBe('veraPDF says 8.2.2');
    expect(compareJobs(job(), job()).trend).toBe('same');
    expect(trendLine(compareJobs(job(), job()))).toBe('The patched copy has as many failed checks as the original.');
    expect(trendLine(compareJobs(patchedDone(), job()))).toBe('The patched copy has 4,596 more failed checks than the original. Look at the new clauses below.');
    expect(trendLine(compareJobs(job(), failedRun()))).toMatch(/^The patched copy did not compile/);
    expect(trendLine(compareJobs(failedRun(), job()))).toBe('The original did not compile; the patched copy did.');
    const noCheck = job({ result: { ...(job().result as NonNullable<CheckerJob['result']>), validation: null } });
    expect(compareJobs(job(), noCheck).trend).toBeNull();
    expect(trendLine(compareJobs(job(), noCheck))).toMatch(/could not be checked/);
    expect(side(failedRun())).toMatchObject({ compiled: false, failedChecks: null });
    expect(compiledWords(side(failedRun()))).toBe('Did not compile');
    expect(compiledWords({ ...side(job()), pages: 1 })).toBe('Compiled, 1 page');
    expect(compiledWords({ ...side(job()), pages: null })).toBe('Compiled');
    expect(failuresWords(side(failedRun()))).toBe('Not checked');
    expect(failuresWords({ ...side(job()), failedChecks: 0 })).toBe('No failure');
    expect(failuresWords({ ...side(job()), failedChecks: 1, failedRules: 1 })).toBe('1 failed check (1 rule)');
    expect(failuresWords({ ...side(job()), failedRules: null })).toBe('4,786 failed checks');
    expect(Object.keys(CHANGE_WORDS)).toEqual(['fixed', 'new', 'unchanged', 'fewer', 'more', 'unknown']);
    // A clause of another specification keeps veraPDF's words; a clause listed twice is added up.
    const other = job({ result: { ...(job().result as NonNullable<CheckerJob['result']>), validation: { ...(job().result?.validation as NonNullable<NonNullable<CheckerJob['result']>['validation']>), clauses: [{ ...clause('7.1', 2), specification: 'ISO 14289-1:2014' }, clause('8.8', 3), clause('8.8', 4)] } } });
    const rows = compareJobs(other, job()).rows;
    expect(rows.find((r) => r.clause === '7.1')).toMatchObject({ words: 'veraPDF says 7.1', change: 'fixed' });
    expect(rows.find((r) => r.clause === '8.8')).toMatchObject({ original: 7, patched: 89 });
  });

  it('AC-43: names the removed fix only when one fix fewer made a finished failing run compile', () => {
    const fail = failedRun();
    expect(finished(fail)).toBe(true);
    expect(finished(failedRun('timeout'))).toBe(false);
    expect(finished(failedRun('cancelled'))).toBe(false);
    expect(finished(job({ status: 'running', result: null }))).toBe(false);
    const ab = new Set(['a', 'b']);
    expect(madeItFail({ accepted: ab, job: fail }, { accepted: new Set(['a']), job: job() })).toBe('b');
    expect(madeItFail({ accepted: ab, job: failedRun('timeout') }, { accepted: new Set(['a']), job: job() })).toBeNull();
    expect(madeItFail({ accepted: ab, job: fail }, { accepted: new Set(['a']), job: fail })).toBeNull();
    expect(madeItFail({ accepted: ab, job: fail }, { accepted: new Set(), job: job() })).toBeNull();
    expect(madeItFail({ accepted: ab, job: fail }, { accepted: new Set(['a', 'c']), job: job() })).toBeNull();
    expect(madeItFail({ accepted: ab, job: job() }, { accepted: new Set(['a']), job: job() })).toBeNull();
  });

  it('says how many checks are left', () => {
    expect(compareModule.checksLeftLine(0)).toBe('No checks left this hour.');
    expect(compareModule.checksLeftLine(1)).toBe('1 check left this hour.');
    expect(compareModule.checksLeftLine(4)).toBe('4 checks left this hour.');
  });
});

describe('R4a.2-4 (g): signing out while a check runs stops it on the checker', () => {
  it('Compile and check: the panel goes, and the job is deleted with the last token the check used', async () => {
    const c = stub(() => job(), { realSleep: true });
    const t = page({ checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Compile and check').click();
    for (let i = 0; i < 200 && !c.posts.length; i++) await settle(1);
    expect(c.posts).toHaveLength(1);
    t.setUser(null);
    await settle();
    expect(t.q('#compile')).toBeNull();
    expect(c.deletes).toHaveLength(1);
  });

  it('Compile patched and compare: both checks’ jobs are deleted; and the token is not kept for a later delete', async () => {
    const c = stub((patched) => (patched ? patchedDone() : job()), { realSleep: true });
    const t = page({ compare: true, checker: c });
    await t.app.handleFile(file('week1.zip', PROJECT));
    t.button('Suggest fixes').click();
    t.button('Compile patched and compare').click();
    for (let i = 0; i < 200 && !c.posts.length; i++) await settle(1);
    t.setUser(null);
    await settle();
    expect(c.deletes.length).toBeGreaterThanOrEqual(1);
    expect(new Set(c.deletes).size).toBe(c.deletes.length);
  });
});

describe('keptToken (R4a.2-4 g)', () => {
  it('gives the token of the moment; once there is none, the last one, once', async () => {
    let now: string | null = 'a';
    const k = keptToken(async () => now);
    expect(await k.orLast()).toBe('a');
    expect(await k.token()).toBe('a');
    now = 'b';
    expect(await k.token()).toBe('b');
    now = null;
    expect(await k.token()).toBeNull();
    expect(await k.orLast()).toBe('b');
    expect(await k.orLast()).toBeNull();
    const throwing = keptToken(async () => {
      throw new Error('offline');
    });
    expect(await throwing.orLast()).toBeNull();
  });
});
