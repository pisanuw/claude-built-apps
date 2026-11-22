import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BCF_READ_BYTES,
  CANCELLED_MESSAGE,
  fileContains,
  NO_NETWORK,
  lualatexArgs,
  remoteDataSources,
  REMOTE_BIBLIOGRAPHY_MESSAGE,
  TexRunner,
  texEnv,
  TIMEOUT_MESSAGE,
  verapdfArgs,
  type JobFolder,
} from '../src/runner.ts';
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
      ...NO_NETWORK,
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
    expect(Object.keys(calls[1].env).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TMPDIR', ...Object.keys(NO_NETWORK)].sort());
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
    expect(calls[1].argv.slice(-3)).toEqual(['biber', '--noconf', './main.bcf']);
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

describe('round 1 of review m3a', () => {
  const BCF = (source: string) =>
    `<?xml version="1.0"?>\n<bcf:controlfile>\n  <bcf:bibdata section="0">\n    <bcf:datasource type="file" datatype="bibtex" glob="false">${source}</bcf:datasource>\n  </bcf:bibdata>\n</bcf:controlfile>\n`;

  it('R3a.1-2: finds data sources that biber would fetch, and only those', () => {
    expect(remoteDataSources(BCF('http://127.0.0.1:9/leak/x.bib'))).toEqual(['http://127.0.0.1:9/leak/x.bib']);
    for (const url of ['https://a/b.bib', 'ftp://a/b.bib', 'file:///etc/passwd', 'HTTP://A/B', 'data:text/plain,x']) expect(remoteDataSources(BCF(url)), url).toEqual([url]);
    for (const local of ['refs.bib', 'sub/refs.bib', '../refs.bib', 'C:/refs.bib', '/abs/refs.bib']) expect(remoteDataSources(BCF(local)), local).toEqual([]);
    expect(remoteDataSources(BCF('refs.bib') + BCF(' https://x/y.bib '))).toEqual(['https://x/y.bib']);
  });

  it('R3a.1-2: refuses a remote bibliography before biber runs', async () => {
    const calls: Call[] = [];
    const out = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), BCF('http://127.0.0.1:9/leak.bib')))] }, 'main.tex', calls);
    expect(out.ok).toBe(false);
    expect(out.failure).toMatchObject({ kind: 'bibliography', message: REMOTE_BIBLIOGRAPHY_MESSAGE });
    expect(calls.map((c) => c.argv.find((a) => a === 'biber' || a === 'lualatex'))).toEqual(['lualatex']);
    const local = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), BCF('refs.bib'))), (c, b) => okRun(c, b)] });
    expect(local.result?.bibliography).toBe('biber');
  });

  it('R3a.1-4, R3a.2-3 (c): finds \\bibdata anywhere in a large .aux, reading it in pieces', async () => {
    const file = path.join(folder.dir, 'big.aux');
    for (const at of [0, 1024 * 1024 - 4, 1024 * 1024 + 7, 2 * 1024 * 1024 + 100]) {
      const pad = 'A'.repeat(at);
      writeFileSync(file, pad + '\\bibdata{refs}' + 'B'.repeat(3 * 1024 * 1024 - at));
      expect(fileContains(file, '\\bibdata{'), String(at)).toBe(true);
    }
    writeFileSync(file, 'x'.repeat(3 * 1024 * 1024));
    expect(fileContains(file, '\\bibdata{')).toBe(false);
    writeFileSync(file, '');
    expect(fileContains(file, '\\bibdata{')).toBe(false);
    const out = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.aux`), 'x'.repeat(1500 * 1024) + '\\bibdata{refs}' + 'y'.repeat(1500 * 1024)))] });
    expect(out.result?.bibliography).toBe('bibtex');
  });

  it('R3a.1-2 round 2: the message check reads what an XML reader reads', () => {
    const URL_ = 'http://127.0.0.1:9/x.bib';
    const forms = [
      `<bcf:datasource type="file">&#104;ttp://127.0.0.1:9/x.bib</bcf:datasource>`,
      `<bcf:datasource type="file">http&#x3a;//127.0.0.1:9/x.bib</bcf:datasource>`,
      `<bcf:datasource type="file"><![CDATA[${URL_}]]></bcf:datasource>`,
      `<bcf:datasource type="file">${URL_}</bcf:datasource >`,
      `<x:datasource xmlns:x="https://sourceforge.net/projects/biblatex" type="file">${URL_}</x:datasource>`,
      `<datasource type="file">${URL_}</ datasource>`,
    ];
    for (const f of forms) expect(remoteDataSources(f), f).toHaveLength(1);
    expect(remoteDataSources('<bcf:datasource type="file">refs.bib</bcf:datasource>')).toEqual([]);
  });

  it('R3a.1-2 round 2: every step gets the proxy variables at a closed port, and veraPDF the same', async () => {
    expect(NO_NETWORK).toEqual({
      http_proxy: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9',
      https_proxy: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
      ftp_proxy: 'http://127.0.0.1:9', FTP_PROXY: 'http://127.0.0.1:9',
      all_proxy: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    });
    const calls: Call[] = [];
    await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), '<bcf:datasource>refs.bib</bcf:datasource>')), (c, b) => okRun(c, b)] }, 'main.tex', calls);
    expect(calls.map((c) => c.argv.find((a) => ['lualatex', 'biber', 'java'].includes(a)))).toEqual(['lualatex', 'biber', 'lualatex', 'java']);
    for (const c of calls) {
      expect(c.env).toMatchObject(NO_NETWORK);
      expect(Object.keys(c.env).some((k) => /^no_proxy$/i.test(k))).toBe(false);
    }
    const java = calls[3].argv;
    for (const p of ['-Dhttp.proxyHost=127.0.0.1', '-Dhttp.proxyPort=9', '-Dhttps.proxyHost=127.0.0.1', '-Dhttps.proxyPort=9', '-DsocksProxyHost=127.0.0.1', '-DsocksProxyPort=9']) expect(java).toContain(p);
  });

  it('R3a.2-3 (a): a folder named like the PDF is removed, not an internal error', async () => {
    mkdirSync(path.join(folder.src, 'main.pdf'));
    writeFileSync(path.join(folder.src, 'main.pdf', 'readme.txt'), 'x');
    const out = await run({});
    expect(out.ok).toBe(true);
  });

  it('R3a.1-7: a PDF of the main file\'s name from the upload is not taken as the result', async () => {
    writeFileSync(path.join(folder.src, 'main.pdf'), '%PDF-1.4 % UPLOADED-NOT-COMPILED');
    const out = await run({ tex: [(c, b) => void writeFileSync(path.join(c, `${b}.log`), texLog(null))] });
    expect(out.failure?.kind).toBe('no-pdf');
    expect(out.pdf).toBeNull();
  });

  it('R3a.1-6: a deleted job runs no further step, after LuaLaTeX, BibTeX or veraPDF', async () => {
    for (const at of ['lualatex', 'bibtex', 'java']) {
      const ac = new AbortController();
      const calls: Call[] = [];
      const spawner = fakeSpawner(
        { tex: [(c, b) => (okRun(c, b, 'Rerun to get'), writeFileSync(path.join(c, `${b}.aux`), '\\bibdata{x}'))], bib: () => ({ code: 1 }) },
        calls,
      );
      const r = new TexRunner({
        user: null,
        texBin: '/t',
        verapdfHome: '/v',
        settle: () => {},
        spawner: async (argv, o) => {
          const res = await spawner(argv, o);
          if (argv.includes(at)) ac.abort();
          return res;
        },
      });
      const out = await r.run({ folder, mainFile: 'main.tex', deadline: Date.now() + 60_000, signal: ac.signal });
      expect(out.failure, at).toEqual({ kind: 'cancelled', message: CANCELLED_MESSAGE, error: null });
      expect(calls.at(-1)?.argv.includes(at), at).toBe(true);
    }
  });
});

describe('R3a.3-1 (a): the .bcf check over a file the job writes', () => {
  it('stays linear on unclosed and unopened data sources', () => {
    // D-55: a size against eight times that size, for each shape. The old expression
    // took 0.6 s on 128 KB and 41 s on 1 MB of `<datasource ` (64 times); a linear
    // one about 8 times. Then 8 MB of each, with a loose bound.
    const fill = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const shapes: [string, (n: number) => string][] = [
      ['<datasource ', (n) => fill('<datasource ', n)],
      ['<datasource>', (n) => fill('<datasource>', n)],
      ['<datasource><![CDATA[', (n) => fill('<datasource><![CDATA[', n)],
      ['one opening, then CDATA openings', (n) => '<bcf:datasource>' + fill('<![CDATA[', n)],
      ['one opening, then text', (n) => '<bcf:datasource type="file">' + 'x'.repeat(n)],
    ];
    const time = (bcf: string) => {
      const t0 = performance.now();
      expect(remoteDataSources(bcf)).toEqual([]);
      return performance.now() - t0;
    };
    for (const [name, make] of shapes) {
      const small = make(128 * 1024);
      const large = make(1024 * 1024);
      time(small);
      const a = time(small);
      const b = time(large);
      expect(b, name).toBeLessThan(16 * a + 250);
      expect(time(make(8 * 1024 * 1024)), name).toBeLessThan(5_000);
    }
  }, 120_000);

  it('still finds a source next to many unclosed tags', () => {
    expect(remoteDataSources('<datasource '.repeat(1000) + '<bcf:datasource type="file">https://x/y.bib</bcf:datasource>')).toEqual(['https://x/y.bib']);
    expect(remoteDataSources('<datasource>'.repeat(1000) + '<bcf:datasource type="file"><![CDATA[https://x/y.bib]]></bcf:datasource>')).toHaveLength(1);
  });

  it('reads only the last 1 MB of the .bcf: a source before that gets biber, which the proxy layer stops', async () => {
    expect(BCF_READ_BYTES).toBe(1024 * 1024);
    const source = '<bcf:datasource type="file">http://127.0.0.1:9/far.bib</bcf:datasource>';
    const pad = `<!--${'x'.repeat(BCF_READ_BYTES)}-->`;
    const far = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), source + pad)), (c, b) => okRun(c, b)] });
    expect(far.result?.bibliography).toBe('biber');
    const near = await run({ tex: [(c, b) => (okRun(c, b), writeFileSync(path.join(c, `${b}.bcf`), pad + source))] });
    expect(near.failure).toMatchObject({ kind: 'bibliography', message: REMOTE_BIBLIOGRAPHY_MESSAGE });
  });
});
