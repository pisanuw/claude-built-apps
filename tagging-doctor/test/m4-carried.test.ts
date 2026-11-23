// @vitest-environment jsdom
/**
 * Milestone 4: the minor findings of milestone 3b's review round 2 carried
 * here (R3b.2-2, R3b.2-3, R3b.2-4; R3b.2-1 and the script's docstring of
 * R3b.2-5 are in the worker). Each test fails without its fix.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { PGF_TABLE_CUT, plainTexError, type CheckerJob } from '../src/core/compile';
import { follow, pdf, runJob, SIGN_IN_AGAIN, UNREACHABLE, type CheckerDeps } from '../src/lib/checker';
import { CourseStore, MemoryDb } from '../src/lib/store';
import { mountApp, type AppDeps, type DroppedFile } from '../src/ui/app';
import { mainFileRefusal, NOTICE_KEY } from '../src/ui/compile';
import { statusIndex } from './helpers';

const BASE = 'https://checker.test';
const running = (over: Partial<CheckerJob> = {}): CheckerJob => ({
  id: 'c'.repeat(32),
  status: 'running',
  mainFile: 'main.tex',
  createdAt: '2026-11-23T12:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  result: null,
  failure: null,
  logTail: [],
  pdf: false,
  expiresAt: null,
  note: null,
  ...over,
});

function deps(fetchStub: (url: string, init: RequestInit) => Promise<Response>) {
  let clock = 0;
  const calls: string[] = [];
  const d: CheckerDeps = {
    base: BASE,
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${String(input)}`);
      return fetchStub(String(input), init);
    }) as typeof fetch,
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
    healthTimeoutMs: 20,
  };
  return { d, calls, clock: () => clock };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('R3b.2-2: a main file the checker always refuses is told at once, and nothing is sent', () => {
  it('names the rule for a path that starts with -, & or \\', () => {
    expect(mainFileRefusal('-draft.tex')).toBe('The checker cannot compile a main file whose path starts with -, & or \\; rename -draft.tex to check it.');
    expect(mainFileRefusal('&x.tex')).toMatch(/rename &x\.tex/);
    expect(mainFileRefusal('-week1/main.tex')).toBe('The checker cannot compile a main file whose path starts with -, & or \\; rename the folder -week1 to check it.');
    expect(mainFileRefusal('thesis.ltx')).toBe('The checker compiles .tex main files only; rename thesis.ltx to thesis.tex to check it.');
    expect(mainFileRefusal('week1/-draft.tex')).toBeNull();
    expect(mainFileRefusal('main.tex')).toBeNull();
  });

  it('on the page: Compile and check sends nothing for -draft.tex', async () => {
    const { d, calls } = deps(async () => json(500, {}));
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const store = new CourseStore(new MemoryDb('u1', () => new Date()));
    const session = new Map([[NOTICE_KEY, '1']]);
    const app: AppDeps = {
      loadStatus: async () => statusIndex(),
      now: () => new Date(),
      session: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => void session.set(k, v) },
      download: () => {},
      pause: async () => {},
      account: { mountSignIn: () => () => {}, onUser: (cb) => cb({ id: 'u1' }), store: () => store, token: async () => 'tok' },
      compile: { checker: d, downloadBlob: () => {} },
    };
    const a = mountApp(root, app);
    const f: DroppedFile = { name: 'p.zip', arrayBuffer: async () => zipSync({ '-draft.tex': strToU8('\\documentclass{article}\\begin{document}x\\end{document}') }).buffer as ArrayBuffer };
    await a.handleFile(f);
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Compile and check') as HTMLButtonElement).click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('#compile [role="alert"]')?.textContent).toBe(mainFileRefusal('-draft.tex'));
    expect(calls).toEqual([]);
  });
});

describe('R3b.2-3: the PDF download and the poll never fail silently on a token or a body', () => {
  it('pdf() resolves with words when the token getter rejects or the body is cut off', async () => {
    const { d } = deps(async () => new Response('%PDF', { status: 200 }));
    expect(await pdf(d, 'c'.repeat(32), () => Promise.reject(new Error('refresh failed')))).toEqual({ error: UNREACHABLE });
    const cut = deps(async () => ({ ok: true, status: 200, blob: () => Promise.reject(new TypeError('network error')) }) as unknown as Response);
    expect(await pdf(cut.d, 'c'.repeat(32), async () => 'tok')).toEqual({ error: UNREACHABLE });
    const ok = await pdf(d, 'c'.repeat(32), async () => 'tok');
    expect('blob' in ok).toBe(true);
  });

  it('follow() rides out a token getter that rejects, or gives none, for a minute, like a lost connection', async () => {
    let gets = 0;
    const { d } = deps(async () => json(200, ++gets < 2 ? running() : running({ status: 'done' })));
    let n = 0;
    // Two tries with no token (one rejects, one gives none), then the token again.
    const token = () => (++n === 1 ? Promise.reject(new Error('offline')) : n === 2 ? Promise.resolve(null) : Promise.resolve('tok'));
    const done = await follow(d, running(), token, () => {});
    expect(done.status).toBe('done');
    // Still none after a minute: the sign-in has ended.
    const never = deps(async () => json(200, running()));
    await expect(follow(never.d, running(), async () => null, () => {})).rejects.toMatchObject({ message: SIGN_IN_AGAIN });
    expect(never.clock()).toBeGreaterThan(60_000);
    const rejecting = deps(async () => json(200, running()));
    await expect(follow(rejecting.d, running(), () => Promise.reject(new Error('x')), () => {})).rejects.toMatchObject({ message: UNREACHABLE });
  });

  it('runJob() says a sign-in that ended in words before anything is sent', async () => {
    const { d, calls } = deps(async () => json(200, { status: 'ok', compile: true, texlive: '', verapdf: '' }));
    const hooks = { onStatus: () => {}, onSent: () => {}, stale: () => false };
    await expect(runJob(d, new Uint8Array(30), 'main.tex', async () => null, hooks)).rejects.toMatchObject({ message: 'Sign in again to compile: your sign-in has ended.', status: 401 });
    await expect(runJob(d, new Uint8Array(30), 'main.tex', () => Promise.reject(new Error('x')), hooks)).rejects.toMatchObject({ message: UNREACHABLE });
    expect(calls).toEqual([]);
  });
});

describe('R3b.2-4: pgfplots\' real "could not read table file" error, wrapped as TeX writes it', () => {
  it('gets plain words, with the closing quote cut off by the wrap', () => {
    // Copied from a real log: LuaLaTeX 2026 on the worker's image, as the worker's firstError keeps the line.
    const real = "Package pgfplots Error: Could not read table file 'data/marks.csv";
    // The wrap can cut the name, so a name with no closing quote is not used (R4a.1-3).
    expect(plainTexError(real)).toBe(PGF_TABLE_CUT);
    expect(plainTexError("Package pgfplots Error: Could not read table file 'data/marks.txt' in 'search path=.'")).toBe('The table file data/marks.txt could not be read. Add it to the zip, or check its name.');
  });
});
