/**
 * One job's steps (Senior's S2-9): LuaLaTeX; then biber when the run wrote a
 * .bcf, or BibTeX when the .aux names a bibliography, and LuaLaTeX again;
 * then LuaLaTeX while the log asks for a rerun (at most 3 runs, 4 with a
 * bibliography); then veraPDF against PDF/UA-2. Never latexmk, never the
 * project's own rc files. Every step runs as the TeX user with the AC-64
 * flags, and all the steps share one 120-second limit.
 */
import { readFileSync } from 'node:fs';
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

export type FailureKind = 'compile-error' | 'timeout' | 'no-pdf' | 'bibliography' | 'bad-upload' | 'internal';

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
}

export interface Runner {
  run(input: RunInput, onStep?: (step: 'lualatex' | 'biber' | 'bibtex' | 'verapdf', ms: number) => void): Promise<RunOutcome>;
}

export const TIMEOUT_MESSAGE =
  'The compile took longer than 2 minutes, so it was stopped. Large TikZ or pgfplots figures are the usual cause: ' +
  'externalize them or compile them as images, and try again.';
export const MAX_LOG_LINES = 50;

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

  async run({ folder, mainFile, deadline }: RunInput, onStep?: Parameters<Runner['run']>[1]): Promise<RunOutcome> {
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
      const r = await this.o.spawner(wrap(argv, limits, this.o.user), { cwd: dir, env: stepEnv, deadline, stdoutLimit: 4 * 1024 * 1024 });
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

    let runs = 0;
    let log = '';
    const tex = async (): Promise<RunOutcome | null> => {
      runs++;
      const r = await step('lualatex', lualatexArgs(base));
      log = readLog();
      if (r.timedOut) return fail('timeout', TIMEOUT_MESSAGE, log);
      if (r.code !== 0) return fail('compile-error', 'LuaLaTeX stopped with an error.', log);
      return null;
    };

    let bad = await tex();
    if (bad) return bad;

    let bibliography: JobResult['bibliography'] = null;
    const aux = safeJobFile(folder.dir, inJob('.aux'), owner);
    if (safeJobFile(folder.dir, inJob('.bcf'), owner)) bibliography = 'biber';
    else if (aux && /\\bibdata\{/.test(readFileSync(aux, 'utf8'))) bibliography = 'bibtex';
    if (bibliography) {
      const r = await step(bibliography, bibliography === 'biber' ? ['biber', `./${base}.bcf`] : ['bibtex', `./${base}`]);
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
