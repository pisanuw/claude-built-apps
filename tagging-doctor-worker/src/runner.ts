/**
 * One job's steps (Senior's S2-9): LuaLaTeX; then biber when the run wrote a
 * .bcf, or BibTeX when the .aux names a bibliography, and LuaLaTeX again;
 * then LuaLaTeX while the log asks for a rerun (at most 3 runs, 4 with a
 * bibliography); then veraPDF against PDF/UA-2. Never latexmk, never the
 * project's own rc files. Every step runs as the TeX user with the AC-64
 * flags, and all the steps share one 120-second limit.
 */
import { closeSync, fstatSync, openSync, readSync, rmSync } from 'node:fs';
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
 * No tool a job runs reaches the network (AC-31, SPEC §4; R3a.1-2, D-72).
 * TeX has `--nosocket`; biber fetches through Perl's LWP, which honours these
 * variables, so every step gets them, pointing at a closed port, and no
 * `no_proxy`. Nothing of a job can listen on that port because no process of a
 * job can open a socket (`--nosocket`, no shell escape, and every step's
 * processes are killed after it), not because the port is below 1024: in a
 * container's own network namespace any user may bind it (R3a.3-2).
 */
export const DEAD_PROXY = 'http://127.0.0.1:9';
export const NO_NETWORK: Record<string, string> = Object.fromEntries(
  ['http_proxy', 'https_proxy', 'ftp_proxy', 'all_proxy'].flatMap((k) => [[k, DEAD_PROXY], [k.toUpperCase(), DEAD_PROXY]]),
);
/** The same for Java (veraPDF): every HTTP, HTTPS and socket connection goes to that closed port, loopback included (R3a.3-2). */
export const JAVA_NO_NETWORK = [
  '-Djava.net.useSystemProxies=false',
  // Java's defaults (localhost|127.*|[::1]) send loopback around the proxy; only an empty value closes that (R3a.3-2).
  '-Dhttp.nonProxyHosts=',
  '-DsocksNonProxyHosts=',
  // The third list: FTP falls back to the SOCKS proxy, but its own default sends loopback around it (R3a.3-2, m3b r1).
  '-Dftp.nonProxyHosts=',
  '-Dhttp.proxyHost=127.0.0.1',
  '-Dhttp.proxyPort=9',
  '-Dhttps.proxyHost=127.0.0.1',
  '-Dhttps.proxyPort=9',
  '-DsocksProxyHost=127.0.0.1',
  '-DsocksProxyPort=9',
];

/**
 * How much of a .bcf the message check reads: its last 1 MB. A real one is
 * about 100 KB; a source beyond that is still not fetched (NO_NETWORK), it only
 * gets biber's message instead of the plain one (R3a.3-1, D-76).
 */
export const BCF_READ_BYTES = 1024 * 1024;

/**
 * The start of a `datasource` element under any prefix, and its end tag, with
 * spaces in it. Neither can cross a `<`, and the rest of the opening tag is
 * read by `tagEnd`, so each attempt ends at the next `<` (R3a.3-1, D-76: this
 * runs on the server's only thread).
 */
const DATASOURCE_START = /<(?:[\w.-]+:)?datasource\b/g;
const DATASOURCE_CLOSE = /<\/\s*(?:[\w.-]+:)?datasource\s*>/y;

/** Where the tag whose attributes start at `i` ends (after its `>`), or -1; a `>` in quotes does not end it (R3a.F-1). */
function tagEnd(text: string, i: number): number {
  let quote = '';
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '<') return -1;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  return -1;
}

/**
 * The data sources in a biber control file (.bcf) that would make biber fetch
 * (R3a.1-2). Only for a plain message: the guarantee is NO_NETWORK. Reads the
 * elements named `datasource` under any prefix, with spaces in the end tag,
 * and takes a value with a URL scheme, a character reference or a CDATA
 * section as remote. A drive letter (`C:`) is not a scheme. Linear. Pure.
 */
export function remoteDataSources(bcf: string): string[] {
  const found: string[] = [];
  const open = new RegExp(DATASOURCE_START.source, 'g');
  const close = new RegExp(DATASOURCE_CLOSE.source, 'y');
  for (let m = open.exec(bcf); m; m = open.exec(bcf)) {
    const start = tagEnd(bcf, open.lastIndex);
    if (start < 0) continue;
    // The value runs to the next `<` that does not open a comment, a CDATA
    // section or a processing instruction (`<!`, `<?`); there the closing tag
    // must stand. A loop, not a regex, so no input can overflow the regex
    // stack (R3a.F-1). Each value ends at the next element, so it stays linear.
    let at = bcf.indexOf('<', start);
    while (at >= 0 && (bcf[at + 1] === '!' || bcf[at + 1] === '?')) at = bcf.indexOf('<', at + 1);
    if (at < 0) break;
    close.lastIndex = at;
    if (!close.test(bcf)) continue;
    const raw = bcf.slice(start, at);
    const value = raw.replace(/&amp;/g, '&').trim();
    // Markup inside the value (a character reference, CDATA, a comment or a
    // processing instruction) is taken as remote: biber reads it through.
    if (/&#|<[!?]/.test(raw) || /^[a-z][a-z0-9+.-]+:/i.test(value)) found.push(value);
    open.lastIndex = close.lastIndex;
  }
  return found;
}

/**
 * How much of the `.aux` is searched for `\bibdata`: its last 8 MB (R3a.F-3).
 * A real one is well under 1 MB; on a larger one only the bibliography of the
 * job itself can be missed. About 65 ms at 0.1 CPU, against 1.6 s for 200 MB.
 */
export const AUX_READ_BYTES = 8 * 1024 * 1024;

/**
 * True when the file's last `maxBytes` hold `needle`, read in 1 MB pieces that
 * overlap by the needle's length, so a large file is never held whole
 * (R3a.1-4, R3a.2-3 c, R3a.F-3).
 */
export function fileContains(file: string, needle: string, maxBytes = AUX_READ_BYTES): boolean {
  const fd = openSync(file, 'r');
  try {
    const piece = Buffer.alloc(1024 * 1024);
    let carry = '';
    let pos = Math.max(0, fstatSync(fd).size - maxBytes);
    for (;;) {
      const n = readSync(fd, piece, 0, piece.length, pos);
      if (n === 0) return false;
      pos += n;
      const text = carry + piece.subarray(0, n).toString('latin1');
      if (text.includes(needle)) return true;
      carry = text.slice(-needle.length);
    }
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
    ...NO_NETWORK,
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
    ...JAVA_NO_NETWORK,
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
    const javaEnv = { PATH: '/usr/bin:/bin', HOME: folder.home, TMPDIR: folder.tmp, LANG: 'C.UTF-8', ...NO_NETWORK };

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
    rmSync(path.join(cwd, `${base}.pdf`), { force: true, recursive: true });

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
    else if (aux && fileContains(aux, '\\bibdata{')) bibliography = 'bibtex';
    if (bcf) {
      // A plain message for a remote bibliography; NO_NETWORK is what stops the fetch (D-72).
      const remote = remoteDataSources(readTail(bcf, BCF_READ_BYTES));
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
