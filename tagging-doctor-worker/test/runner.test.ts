import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lualatexArgs, TexRunner, texEnv, TIMEOUT_MESSAGE, verapdfArgs, type JobFolder } from '../src/runner.ts';
import { fakeSpawner, okRun, texLog, type Call, type Script } from './fakes.ts';

let folder: JobFolder;
beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tdw-run-'));
  folder = { dir, src: path.join(dir, 'src'), home: path.join(dir, 'home'), tmp: path.join(dir, 'tmp') };
  for (const d of [folder.src, folder.home, folder.tmp, path.join(folder.src, 'notes')]) mkdirSync(d, { recursive: true });
});
afterEach(() => rmSync(folder.dir, { recursive: true, force: true }));

const me = process.getuid?.() ?? 0;
function runner(script: Script, calls: Call[] = [], user: { uid: number; gid: number } | null = null) {
  let settled = 0;
  const r = new TexRunner({ user, texBin: '/tex/bin', verapdfHome: '/opt/verapdf', spawner: fakeSpawner(script, calls), settle: () => settled++ });
  return { r, settled: () => settled };
}
const run = (script: Script, mainFile = 'main.tex', calls: Call[] = []) => runner(script, calls).r.run({ folder, mainFile, deadline: Date.now() + 60_000 });

describe('AC-64: the flags and the environment', () => {
  it('calls lualatex with --nosocket and --no-shell-escape, on ./<file>', () => {
    expect(lualatexArgs('-odd')).toEqual(['lualatex', '--nosocket', '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--file-line-error', './-odd.tex']);
  });

  it('gives TeX a minimal environment with openout_any=p and HOME, TMPDIR and the cache inside the job', () => {
    expect(texEnv(folder, '/tex/bin')).toEqual({
      PATH: '/tex/bin:/usr/bin:/bin',
      HOME: folder.home,
      TMPDIR: folder.tmp,
      LANG: 'C.UTF-8',
      TEXMFVAR: path.join(folder.home, 'texmf-var'),
      TEXMFCACHE: path.join(folder.home, 'texmf-var'),
      openout_any: 'p',
      shell_escape: 'f',
    });
  });

  it("caps veraPDF's heap and puts java.io.tmpdir in the job", () => {
    const a = verapdfArgs('/j/src/main.pdf', folder, '/opt/verapdf');
    expect(a).toContain('-Xmx192m');
    expect(a).toContain(`-Djava.io.tmpdir=${folder.tmp}`);
    expect(a).toContain(`-Duser.home=${folder.home}`);
    expect(a.slice(-7)).toEqual(['--flavour', 'ua2', '--format', 'json', '--maxfailuresdisplayed', '1', '/j/src/main.pdf']);
  });

  it('runs every step as the TeX user, in the main file folder, with no variable of the server', async () => {
    const calls: Call[] = [];
    const { r, settled } = runner({}, calls, { uid: me, gid: 0 });
    process.env.SECRET_OF_SERVER = 'x';
    const out = await r.run({ folder, mainFile: 'notes/main.tex', deadline: Date.now() + 60_000 });
    delete process.env.SECRET_OF_SERVER;
    expect(out.ok).toBe(true);
    expect(calls.map((c) => c.argv.slice(8, 10))).toEqual([[`--reuid=${me}`, '--regid=0'], [`--reuid=${me}`, '--regid=0']]);
    expect(calls[0].cwd).toBe(path.join(folder.src, 'notes'));
    expect(calls[1].cwd).toBe(folder.dir);
    for (const c of calls) expect(Object.keys(c.env)).not.toContain('SECRET_OF_SERVER');
    expect(Object.keys(calls[1].env).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TMPDIR']);
    expect(settled()).toBe(2);
  });
});

describe('the job steps (S2-9)', () => {
  it('compiles once and validates, with pages, warnings and the veraPDF result', async () => {
    const calls: Call[] = [];
    const out = await run({ tex: [(c, b) => okRun(c, b, 'LaTeX Warning: one\nPackage x Warning: two')] }, 'main.tex', calls);
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ pages: 3, warnings: 2, runs: 1, bibliography: null, validationError: null });
    expect(out.result?.validation?.failedRules).toBe(9);
    expect(out.pdf).toBe(path.join(folder.src, 'main.pdf'));
    expect(out.logTail.at(-1)).toMatch(/Output written/);
  });

  it('reruns while LaTeX asks, at most 3 runs', async () => {
    const out = await run({ tex: [(c, b) => okRun(c, b, 'Rerun to get cross-references right.')] });
    expect(out.result?.runs).toBe(3);
    const twice = await run({ tex: [(c, b) => okRun(c, b, 'Rerun to get cross-references right.'), (c, b) => okRun(c, b)] });
    expect(twice.result?.runs).toBe(2);
  });

  it('runs biber when the first run wrote a .bcf, then LuaLaTeX again', async () => {
    const calls: Call[] = [];
    const out = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), '<bcf/>')), (c, b) => okRun(c, b)] }, 'main.tex', calls);
    expect(out.result).toMatchObject({ bibliography: 'biber', runs: 2 });
    expect(calls.map((c) => c.argv.at(-2) === 'biber' || c.argv.includes('biber'))).toEqual([false, true, false, false]);
    expect(calls[1].argv.slice(-2)).toEqual(['biber', './main.bcf']);
  });

  it('runs BibTeX when the .aux names a bibliography', async () => {
    const calls: Call[] = [];
    const out = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.aux`), '\\bibdata{refs}\n'))] }, 'main.tex', calls);
    expect(out.result?.bibliography).toBe('bibtex');
    expect(calls[1].argv.slice(-2)).toEqual(['bibtex', './main']);
  });

  it('reports a biber failure with its own log', async () => {
    const out = await run({
      tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), ''), writeFileSync(path.join(c, `${b}.blg`), 'ERROR - main.tex:3: bad entry'))],
      bib: () => ({ code: 2 }),
    });
    expect(out.ok).toBe(false);
    expect(out.failure).toMatchObject({ kind: 'bibliography', message: 'biber stopped with an error.' });
    expect(out.logTail).toEqual(['ERROR - main.tex:3: bad entry']);
  });

  it('goes on after a BibTeX warning exit code', async () => {
    const out = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.aux`), '\\bibdata{refs}'))], bib: () => ({ code: 1 }) });
    expect(out.ok).toBe(true);
  });

  it('reports a compile error with its file and line, and the last 50 log lines', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
    const out = await run({ tex: [(c, b) => (writeFileSync(path.join(c, `${b}.log`), `${lines}\n./main.tex:7: Undefined control sequence.\n`), { code: 1 })] });
    expect(out.ok).toBe(false);
    expect(out.failure).toEqual({ kind: 'compile-error', message: 'LuaLaTeX stopped with an error.', error: { file: 'main.tex', line: 7, message: 'Undefined control sequence.' } });
    expect(out.logTail).toHaveLength(50);
    expect(out.pdf).toBeNull();
  });

  it('stops at the time limit with a plain message, at any step', async () => {
    const out = await run({ tex: [() => ({ code: null, signal: 'SIGKILL', timedOut: true })] });
    expect(out.failure).toEqual({ kind: 'timeout', message: TIMEOUT_MESSAGE, error: null });
    const late = await run({ verapdf: () => ({ timedOut: true, code: null }) });
    expect(late.failure?.kind).toBe('timeout');
    const bib = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), ''))], bib: () => ({ timedOut: true }) });
    expect(bib.failure?.kind).toBe('timeout');
    const second = await run({ tex: [(c, b) => okRun(c, b, 'Rerun to get'), () => ({ code: 1 })] });
    expect(second.failure?.kind).toBe('compile-error');
  });

  it('fails when no PDF was written, and says when veraPDF could not check it', async () => {
    const none = await run({ tex: [(c, b) => void writeFileSync(path.join(c, `${b}.log`), texLog(null))] });
    expect(none.failure?.kind).toBe('no-pdf');
    const broken = await run({ verapdf: () => ({ stdout: 'Exception in thread main', code: 1 }) });
    expect(broken.ok).toBe(true);
    expect(broken.result).toMatchObject({ validation: null, validationError: 'veraPDF could not check this PDF.' });
  });

  it('ignores a PDF or log that is a link (to a file of the server)', async () => {
    const out = await run({
      tex: [(c, b) => {
        writeFileSync(path.join(folder.dir, 'secret'), 'SECRET');
        symlinkSync(path.join(folder.dir, 'secret'), path.join(c, `${b}.log`));
        symlinkSync(path.join(folder.dir, 'secret'), path.join(c, `${b}.pdf`));
      }],
    });
    expect(out.failure?.kind).toBe('no-pdf');
    expect(out.logTail.join('\n')).not.toContain('SECRET');
  });
});
