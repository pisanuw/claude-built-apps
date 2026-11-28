/**
 * One job, in a Node process of its own (D-32), started by runner.ts as the
 * server's user at nice 10: it serves the capture page, pdf.js and the file
 * on a loopback port under a random path; starts Chromium as the job user
 * with its sandbox on (no `--no-sandbox`, no `no_new_privs`, AC-14) over
 * `--remote-debugging-pipe`; runs the capture (capture.ts); ends Chromium and
 * every process of the job user; then runs veraPDF as the job user with the
 * checker's Java flags (AC-14). It writes the output's bytes to stdout and
 * its stages and its end to the IPC channel, so the hub's thread never
 * parses a CDP message or the output (AC-12, AC-22).
 *
 *   node driver.ts '<JSON DriverArgs>'
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Cdp } from './cdp.ts';
import { capture, CaptureFailure, type Captured, type Failure } from './capture.ts';
import { assemble } from './output.ts';
import { asUser, killUid } from './sandbox.ts';
import { parseReport, verapdfArgs, type Validation } from './verapdf.ts';

export interface DriverArgs {
  file: string;
  jobDir: string;
  uid: number;
  gid: number;
  chrome: string;
  staticDir: string;
  pdfjsDir: string;
  verapdfHome: string;
  deadline: number;
  outputCap: number;
  nodeCap: number;
  maxPages: number;
  /** False for the self-test, which reads only the heard tree. */
  verapdf: boolean;
  /** Chromium's fontconfig file, when there is one (D-43). */
  fontconfigFile?: string;
  /** The self-test's heading text: the summary says whether the heard tree has a heading and that text (AC-23). */
  expect?: string;
}

export type DriverMessage =
  | { type: 'stage'; stage: 'reading' | 'validating' }
  | { type: 'fail'; reason: Failure | 'no-sandbox' | 'internal'; detail?: string }
  | { type: 'done'; bytes: number; summary: Record<string, unknown> };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.icc': 'application/octet-stream',
};

/** The pdf.js files the page may load: these folders and files of pdfjs-dist, nothing else. */
const PDFJS_ALLOWED = ['build/pdf.mjs', 'build/pdf.worker.mjs', 'web/pdf_viewer.mjs', 'web/pdf_viewer.css', 'cmaps/', 'standard_fonts/', 'wasm/', 'iccs/'];

/** Where a request path below the secret prefix is served from, or null. Pure. */
export function resolveStatic(rel: string, staticDir: string, pdfjsDir: string): string | null {
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.split('/').some((p) => p === '..' || p === '.' || p === '')) return null;
  if (rel === 'capture.html' || rel === 'capture.mjs') return path.join(staticDir, rel);
  if (rel.startsWith('pdfjs/')) {
    const inner = rel.slice('pdfjs/'.length);
    if (PDFJS_ALLOWED.some((a) => (a.endsWith('/') ? inner.startsWith(a) && inner.length > a.length : inner === a))) return path.join(pdfjsDir, inner);
  }
  return null;
}

/** The job's loopback server: the page and pdf.js under `/<secret>/`, the file at `/<secret>/job.pdf`. */
export async function staticServer(file: string, staticDir: string, pdfjsDir: string): Promise<{ base: string; close: () => void }> {
  const secret = randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const prefix = `/${secret}/`;
    if (req.method !== 'GET' || !url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const rel = url.pathname.slice(prefix.length);
    const target = rel === 'job.pdf' ? file : resolveStatic(rel, staticDir, pdfjsDir);
    let ok = false;
    try {
      ok = target !== null && statSync(target).isFile();
    } catch {
      ok = false;
    }
    if (!ok || !target) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': rel === 'job.pdf' ? 'application/pdf' : (TYPES[path.extname(target)] ?? 'application/octet-stream'), 'cache-control': 'no-store' });
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}/${secret}/`, close: () => server.close() };
}

/** Chromium's flags: headless shell, the DevTools pipe, a profile in the job, and no network but loopback (AC-15). Pure. */
export function chromeArgs(profile: string): string[] {
  return [
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-component-update',
    '--disable-breakpad',
    '--mute-audio',
    '--hide-scrollbars',
    '--renderer-process-limit=1',
    '--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache',
    // No network but loopback: everything else goes to a closed port, and no host name resolves.
    '--proxy-server=http://127.0.0.1:9',
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    'about:blank',
  ];
}

/**
 * The job user's Chromium processes: how many, how many under a seccomp
 * filter, and how many in a PID namespace of their own (two or more numbers
 * on `NSpid`), which is what Chromium's namespace sandbox makes for its
 * renderer and utilities (AC-14, D-38). Under Docker every process has
 * Docker's own seccomp filter, so `seccomp` alone proves nothing there.
 */
export interface SandboxFacts {
  processes: number;
  seccomp: number;
  namespaced: number;
}

export function sandboxFacts(uid: number, procRoot = '/proc'): SandboxFacts {
  let processes = 0;
  let seccomp = 0;
  let namespaced = 0;
  for (const name of readdirSync(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const s = readFileSync(path.join(procRoot, name, 'status'), 'utf8');
      if (Number(/^Uid:\s+(\d+)/m.exec(s)?.[1]) !== uid || !/^Name:\s+.*chrome/m.test(s)) continue;
      processes++;
      if (/^Seccomp:\s+2$/m.test(s)) seccomp++;
      if (/^NSpid:\s+\d+\s+\d+/m.test(s)) namespaced++;
    } catch {
      /* gone */
    }
  }
  return { processes, seccomp, namespaced };
}

function send(msg: DriverMessage): Promise<void> {
  return new Promise((r) => (process.send ? process.send(msg, () => r()) : r()));
}

/** Runs argv as the job user under rlimits, collecting at most `limit` bytes of stdout, killed at `deadline`. */
function runCollect(argv: string[], env: Record<string, string>, cwd: string, deadline: number, limit: number): Promise<{ code: number | null; timedOut: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, Math.max(0, deadline - Date.now()));
    child.stdout?.on('data', (b: Buffer) => {
      if (size < limit) chunks.push(b.subarray(0, limit - size));
      size += b.length;
    });
    child.on('error', () => undefined);
    child.on('close', (code) => {
      clearTimeout(timer);
      kill();
      resolve({ code, timedOut, stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

async function verapdf(a: DriverArgs, declared: number | null): Promise<{ v: Validation | null; err: 'timeout' | 'failed' | null }> {
  // At least 2 seconds must be left for veraPDF to be worth starting.
  if (a.deadline - Date.now() < 2_000) return { v: null, err: 'timeout' };
  const tmp = path.join(a.jobDir, 'tmp');
  const argv = [
    'prlimit',
    `--fsize=${200 * 1024 * 1024}`,
    '--nproc=64',
    '--nofile=256',
    '--core=0',
    '--',
    ...asUser(verapdfArgs(a.file, tmp, a.jobDir, a.verapdfHome, declared), a.uid, a.gid, true),
  ];
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: a.jobDir, LANG: 'C.UTF-8' };
  const r = await runCollect(argv, env, a.jobDir, a.deadline - 500, 8 * 1024 * 1024);
  if (r.timedOut) return { v: null, err: 'timeout' };
  const v = parseReport(r.stdout, declared);
  return { v, err: v ? null : 'failed' };
}

/**
 * A reaper for Chromium (D-44): Perl (in the TeX image) marks itself a child
 * subreaper, starts Chromium, and waits until every process below it has
 * ended, so Chromium's zygote and renderers, orphaned when the browser
 * process ends, are reaped here and not left as zombies of the hub, which is
 * the container's PID 1 and reaps only its own children. It runs in a session
 * of its own, so killing the driver's group leaves it to reap what the
 * clean-up kills. 157 is prctl and 36 PR_SET_CHILD_SUBREAPER on x86-64.
 */
export const REAPER = 'syscall(157, 36, 1); my $p = fork(); die "fork" unless defined $p; if ($p == 0) { exec { $ARGV[0] } @ARGV or exit 127 } alarm 600; while (waitpid(-1, 0) > 0) {} exit 0;';

/** The argv that starts Chromium as the job user under the reaper. Pure. */
export function chromeArgv(a: Pick<DriverArgs, 'chrome' | 'jobDir' | 'uid' | 'gid'>): string[] {
  return ['perl', '-e', REAPER, ...asUser([a.chrome, ...chromeArgs(path.join(a.jobDir, 'profile'))], a.uid, a.gid, false)];
}

function startChrome(a: DriverArgs): { proc: ChildProcess; stderr: () => string; exited: Promise<void> } {
  const argv = chromeArgv(a);
  const proc = spawn(argv[0], argv.slice(1), {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    env: { HOME: a.jobDir, TMPDIR: path.join(a.jobDir, 'tmp'), PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', ...(a.fontconfigFile ? { FONTCONFIG_FILE: a.fontconfigFile } : {}) },
    cwd: a.jobDir,
  });
  let err = '';
  proc.stdio[2]?.on('data', (d: Buffer) => {
    if (err.length < 20_000) err += d.toString('utf8');
  });
  const exited = new Promise<void>((r) => proc.once('exit', () => r()));
  return { proc, stderr: () => err, exited };
}

/**
 * Ends Chromium (D-44): the job user's processes are killed and the reaper,
 * which runs as the driver's user, is left to reap them and end, so none is
 * orphaned to the hub. Killing the reaper first would leave Chromium's
 * processes as zombies of the hub. A process started meanwhile is killed on
 * the next pass; the reaper is killed only if it has not ended after three.
 */
export async function stopChrome(chrome: { proc: Pick<ChildProcess, 'kill'>; exited: Promise<void> }, uid: number, kill: (uid: number) => number = killUid, waitMs = 2_000): Promise<void> {
  for (let i = 0; i < 3; i++) {
    kill(uid);
    const ended = await Promise.race([chrome.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), waitMs).unref())]);
    if (ended) return;
  }
  chrome.proc.kill('SIGKILL');
}

export async function runDriver(a: DriverArgs): Promise<void> {
  await send({ type: 'stage', stage: 'reading' });
  const fileBytes = readFileSync(a.file);
  const file = { bytes: fileBytes.length, sha256: createHash('sha256').update(fileBytes).digest('hex') };
  const server = await staticServer(a.file, a.staticDir, a.pdfjsDir);
  const chrome = startChrome(a);
  const cdp = new Cdp(chrome.proc.stdio[3] as Writable, chrome.proc.stdio[4] as Readable, a.outputCap);
  let captured: Captured;
  let sandbox: SandboxFacts = { processes: 0, seccomp: 0, namespaced: 0 };
  try {
    const started = Promise.race([
      cdp.send('Browser.getVersion'),
      chrome.exited.then(() => {
        throw new Error('chrome exited');
      }),
    ]);
    await started;
    sandbox = sandboxFacts(a.uid);
    captured = await capture(cdp, { base: server.base, outputCap: a.outputCap, nodeCap: a.nodeCap, maxPages: a.maxPages, deadline: a.deadline });
    sandbox = pickMax(sandbox, sandboxFacts(a.uid));
  } catch (e) {
    server.close();
    await stopChrome(chrome, a.uid);
    if (e instanceof CaptureFailure) return send({ type: 'fail', reason: e.reason, detail: e.message.slice(0, 200) });
    const err = chrome.stderr();
    if (/No usable sandbox/i.test(err)) return send({ type: 'fail', reason: 'no-sandbox' });
    return send({ type: 'fail', reason: 'chrome-failed', detail: `${String((e as Error)?.message ?? e).slice(0, 200)} ${err.slice(-300)}` });
  }
  await cdp.send('Browser.close').catch(() => undefined);
  await Promise.race([chrome.exited, new Promise((r) => setTimeout(r, 5_000))]);
  server.close();
  // veraPDF and Chromium never run at the same time: every process of the job user ends first.
  await stopChrome(chrome, a.uid);
  let v: Validation | null = null;
  let err: 'timeout' | 'failed' | null = null;
  if (a.verapdf) {
    await send({ type: 'stage', stage: 'validating' });
    ({ v, err } = await verapdf(a, captured.opened.declaredUa));
  }
  const out = assemble(captured, file, v, err);
  const summary = {
    pages: captured.opened.pages,
    pagesRead: captured.opened.pagesRead,
    structNodes: captured.structNodes,
    axNodes: captured.axNodes,
    outputBytes: out.length,
    largestAnswer: cdp.largest,
    outside: captured.outside,
    failedReads: captured.failedReads,
    sandbox,
    chromium: captured.chromium,
    pdfjs: captured.opened.pdfjs,
    tagged: captured.tagged,
    structCut: captured.structCut,
    verapdf: v ? v.compliant : null,
    verapdfError: err,
    // For the self-test (AC-23): a heading, and its text heard (pdf.js's aria-owns into a `display: contents` span is not followed, D-39).
    heading: a.expect ? hasHeading(captured.heard, a.expect) : undefined,
  };
  await send({ type: 'done', bytes: out.length, summary });
  await new Promise<void>((r) => process.stdout.write(out, () => r()));
}

/** True when the heard tree has a heading node and the text `expect`, as the heading's name or as text. Pure. */
export function hasHeading(heard: string[], expect: string): boolean {
  let heading = false;
  let text = false;
  for (const h of heard) {
    const n = JSON.parse(h) as { r?: string; n?: string };
    if (n.r === 'heading') heading = true;
    if (n.n === expect && (n.r === 'heading' || n.r === 'StaticText')) text = true;
  }
  return heading && text;
}

/** The reading with more sandboxed processes (the renderer exists only once a page is open). */
function pickMax(a: SandboxFacts, b: SandboxFacts): SandboxFacts {
  return b.namespaced > a.namespaced || (b.namespaced === a.namespaced && b.processes > a.processes) ? b : a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = JSON.parse(process.argv[2] ?? '{}') as DriverArgs;
  runDriver(args)
    .catch(async (e) => {
      await send({ type: 'fail', reason: 'internal', detail: String((e as Error)?.message ?? e).slice(0, 200) });
    })
    .finally(() => {
      process.exit(0);
    });
}
