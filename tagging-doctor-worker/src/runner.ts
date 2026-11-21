/**
 * One job's steps (Senior's S2-9): LuaLaTeX; then biber when the run wrote a
 * .bcf, or BibTeX when the .aux names a bibliography, and LuaLaTeX again;
 * then LuaLaTeX while the log asks for a rerun (at most 3 runs, 4 with a
 * bibliography); then veraPDF against PDF/UA-2. Never latexmk, never the
 * project's own rc files. Every step runs as the TeX user with the AC-64
 * flags, and all the steps share one 120-second limit.
 */
import { closeSync, openSync, readSync, rmSync } from 'node:fs';
import path from 'node:path';
import { JAVA_LIMITS, TEX_LIMITS, readTail, safeJobFile, wrap, type Spawner, type User } from './sandbox.ts';
import { firstError, pageCount, tail, warningCount, wantsRerun, type TexError } from './texlog.ts';
import { parseReport, type Validation } from './verapdf.ts';

export interface JobResult {
  pages: number | null;
  seconds: number;
  warnings: number;
  runs: number;
  bibliography: 'biber' | 'bibtex' | null;
  validation: Validation | null;
  validationError: string | null;
}

export type FailureKind = 'compile-error' | 'timeout' | 'no-pdf' | 'bibliography' | 'bad-upload' | 'internal' | 'cancelled';

export interface Failure {
  kind: FailureKind;
  message: string;
  error: TexError | null;
}

export interface RunOutcome {
  ok: boolean;
  result: JobResult | null;
  failure: Failure | null;
  /** The last 50 lines of the TeX log (for the job's owner only; never logged). */
  logTail: string[];
  /** The PDF, checked to be the job's own plain file. */
  pdf: string | null;
}

export interface JobFolder {
  dir: string;
  src: string;
  home: string;
  tmp: string;
}

export interface RunInput {
  folder: JobFolder;
  mainFile: string;
  deadline: number;
  /** Aborted when the job is deleted: the running step is killed and no other starts (R3a.1-6). */
  signal?: AbortSignal;
}

export interface Runner {
  run(input: RunInput, onStep?: (step: 'lualatex' | 'biber' | 'bibtex' | 'verapdf', ms: number) => void): Promise<RunOutcome>;
}

export const TIMEOUT_MESSAGE =
  'The compile took longer than 2 minutes, so it was stopped. Large TikZ or pgfplots figures are the usual cause: ' +
  'externalize them or compile them as images, and try again.';
export const MAX_LOG_LINES = 50;
export const REMOTE_BIBLIOGRAPHY_MESSAGE = 'Remote bibliographies are not fetched; add the .bib file to the zip.';
export const CANCELLED_MESSAGE = 'The check was deleted.';

/**
 * The data sources in a biber control file (.bcf) that name a URL or another
 * scheme (http:, https:, ftp:, file:, data: …), which biber would fetch itself
 * (R3a.1-2). A drive letter (`C:`) is not a scheme. Pure.
 */
export function remoteDataSources(bcf: string): string[] {
  const found: string[] = [];
  for (const m of bcf.matchAll(/<bcf:datasource\b[^>]*>([^<]*)<\/bcf:datasource>/g)) {
    const value = m[1].replace(/&amp;/g, '&').trim();
    if (/^[a-z][a-z0-9+.-]+:/i.test(value)) found.push(value);
  }
  return found;
}

/** The first and last `bytes` of a file, so a huge file is never read whole (R3a.1-4). */
export function headAndTail(file: string, bytes: number): string {
  const tailText = readTail(file, bytes);
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(bytes);
    const n = readSync(fd, head, 0, bytes, 0);
    return `${head.subarray(0, n).toString('utf8')}\n${tailText}`;
  } finally {
    closeSync(fd);
  }
}

export interface TexRunnerOptions {
  user: User | null;
  texBin: string;
  verapdfHome: string;
  spawner: Spawner;
  /** Called after each step, to kill anything the step left running. */
  settle: () => void;
  now?: () => number;
}

/** The TeX environment: only what TeX needs, nothing of the server's (AC-64). Pure. */
export function texEnv(folder: JobFolder, texBin: string): Record<string, string> {
  const cache = path.join(folder.home, 'texmf-var');
  return {
    PATH: `${texBin}:/usr/bin:/bin`,
    HOME: folder.home,
    TMPDIR: folder.tmp,
    LANG: 'C.UTF-8',
    TEXMFVAR: cache,
    TEXMFCACHE: cache,
    openout_any: 'p',
    shell_escape: 'f',
  };
}

/** `lualatex` with the AC-64 flags; the file is passed as ./<name>, never through a shell. Pure. */
export function lualatexArgs(base: string): string[] {
  return ['lualatex', '--nosocket', '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--file-line-error', `./${base}.tex`];
}

/** veraPDF's command line, with a capped heap and Java's temp folder in the job (AC-64). Pure. */
export function verapdfArgs(pdf: string, folder: JobFolder, verapdfHome: string): string[] {
  return [
    'java',
    '-Xmx192m',
    '-Xss512k',
    '-XX:MaxMetaspaceSize=96m',
    '-XX:ReservedCodeCacheSize=32m',
    '-XX:+UseSerialGC',
    '-XX:TieredStopAtLevel=1',
    '-XX:-UsePerfData',
    `-Djava.io.tmpdir=${folder.tmp}`,
    `-Duser.home=${folder.home}`,
    '-Dfile.encoding=UTF8',
    '-classpath',
    `${verapdfHome}/bin/*`,
    '--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED',
    'org.verapdf.apps.GreenfieldCliWrapper',
    '--flavour',
    'ua2',
    '--format',
    'json',
    '--maxfailuresdisplayed',
    '1',
    pdf,
  ];
}

export class TexRunner implements Runner {
  private readonly o: TexRunnerOptions;
  constructor(o: TexRunnerOptions) {
    this.o = o;
  }

  async run({ folder, mainFile, deadline, signal }: RunInput, onStep?: Parameters<Runner['run']>[1]): Promise<RunOutcome> {
    const now = this.o.now ?? Date.now;
    const started = now();
    const owner = this.o.user?.uid ?? null;
    const relDir = path.posix.dirname(mainFile);
    const cwd = path.join(folder.src, relDir);
    const base = path.posix.basename(mainFile).replace(/\.tex$/i, '');
    const inJob = (ext: string) => path.posix.join('src', relDir, `${base}${ext}`);
    const env = texEnv(folder, this.o.texBin);
    const javaEnv = { PATH: '/usr/bin:/bin', HOME: folder.home, TMPDIR: folder.tmp, LANG: 'C.UTF-8' };

    const step = async (name: 'lualatex' | 'biber' | 'bibtex' | 'verapdf', argv: string[], limits = TEX_LIMITS, stepEnv = env, dir = cwd) => {
      const t0 = now();
      const r = await this.o.spawner(wrap(argv, limits, this.o.user), { cwd: dir, env: stepEnv, deadline, stdoutLimit: 4 * 1024 * 1024, signal });
      this.o.settle();
      onStep?.(name, now() - t0);
      return r;
    };
    const readLog = (): string => {
      const file = safeJobFile(folder.dir, inJob('.log'), owner);
      return file ? readTail(file, 2 * 1024 * 1024) : '';
    };
    const fail = (kind: FailureKind, message: string, log: string): RunOutcome => ({
      ok: false,
      result: null,
      failure: { kind, message, error: kind === 'compile-error' || kind === 'bibliography' ? firstError(log) : null },
      logTail: tail(log, MAX_LOG_LINES),
      pdf: null,
    });

    const cancelled = (): RunOutcome => ({ ok: false, result: null, failure: { kind: 'cancelled', message: CANCELLED_MESSAGE, error: null }, logTail: [], pdf: null });

    // A PDF of the main file's name that came in the upload is not the compile's result (R3a.1-7).
    rmSync(path.join(cwd, `${base}.pdf`), { force: true });

    let runs = 0;
    let log = '';
    const tex = async (): Promise<RunOutcome | null> => {
      runs++;
      const r = await step('lualatex', lualatexArgs(base));
      if (signal?.aborted) return cancelled();
      log = readLog();
      if (r.timedOut) return fail('timeout', TIMEOUT_MESSAGE, log);
      if (r.code !== 0) return fail('compile-error', 'LuaLaTeX stopped with an error.', log);
      return null;
    };

    let bad = await tex();
    if (bad) return bad;

    let bibliography: JobResult['bibliography'] = null;
    const aux = safeJobFile(folder.dir, inJob('.aux'), owner);
    const bcf = safeJobFile(folder.dir, inJob('.bcf'), owner);
    if (bcf) bibliography = 'biber';
    else if (aux && /\\bibdata\{/.test(headAndTail(aux, 1024 * 1024))) bibliography = 'bibtex';
    if (bcf) {
      // biber fetches remote data sources itself, outside TeX's --nosocket (R3a.1-2).
      const remote = remoteDataSources(headAndTail(bcf, 1024 * 1024));
      if (remote.length > 0) return fail('bibliography', REMOTE_BIBLIOGRAPHY_MESSAGE, log);
    }
    if (bibliography) {
      // --noconf: no biber.conf that the job itself could have written steers biber.
      const r = await step(bibliography, bibliography === 'biber' ? ['biber', '--noconf', `./${base}.bcf`] : ['bibtex', `./${base}`]);
      if (signal?.aborted) return cancelled();
      if (r.timedOut) return fail('timeout', TIMEOUT_MESSAGE, log);
      if (r.code !== 0 && bibliography === 'biber') {
        const blg = safeJobFile(folder.dir, inJob('.blg'), owner);
        return fail('bibliography', 'biber stopped with an error.', blg ? readTail(blg, 64 * 1024) : '');
      }
      bad = await tex();
      if (bad) return bad;
    }
    while (wantsRerun(log) && runs < (bibliography ? 4 : 3)) {
      bad = await tex();
      if (bad) return bad;
    }

    const pdf = safeJobFile(folder.dir, inJob('.pdf'), owner);
    if (!pdf) return fail('no-pdf', 'LuaLaTeX finished without writing a PDF.', log);

    const v = await step('verapdf', verapdfArgs(pdf, folder, this.o.verapdfHome), JAVA_LIMITS, javaEnv, folder.dir);
    if (signal?.aborted) return cancelled();
    if (v.timedOut) return fail('timeout', TIMEOUT_MESSAGE, log);
    const validation = parseReport(v.stdout);
    return {
      ok: true,
      result: {
        pages: pageCount(log),
        seconds: Math.round((now() - started) / 100) / 10,
        warnings: warningCount(log),
        runs,
        bibliography,
        validation,
        validationError: validation ? null : 'veraPDF could not check this PDF.',
      },
      failure: null,
      logTail: tail(log, MAX_LOG_LINES),
      pdf,
    };
  }
}
