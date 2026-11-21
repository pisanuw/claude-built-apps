/**
 * How TeX and veraPDF are run (AC-64): as the TeX user through `setpriv`,
 * under rlimits set by `prlimit`, in a process group of their own, with a
 * minimal environment, and never through a shell. After a job every process
 * of the TeX user is killed and its files outside the job are removed, and
 * the server reads what the job wrote only after checking that it is a plain
 * file of the TeX user inside the job's folder (no link to a file of the
 * server's).
 */
import { spawn } from 'node:child_process';
import {
  chownSync,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

export interface Limits {
  /** Address space in bytes, or 'unlimited' (Java reserves far more than it uses; its heap is capped instead). */
  addressSpace: number | 'unlimited';
  fileSize: number;
  processes: number;
  openFiles: number;
}

/**
 * 400 MiB of address space for TeX: math-notes peaks at 153 MiB untagged and
 * 241 MiB tagged (D-60), and TeX plus the server stay under the instance's
 * 512 MB, so a memory bomb meets this limit before the out-of-memory killer.
 */
export const TEX_LIMITS: Limits = { addressSpace: 400 * 1024 * 1024, fileSize: 200 * 1024 * 1024, processes: 64, openFiles: 256 };
export const JAVA_LIMITS: Limits = { addressSpace: 'unlimited', fileSize: 200 * 1024 * 1024, processes: 64, openFiles: 256 };

export interface User {
  uid: number;
  gid: number;
}

/** The argv that runs `argv` as `user` (or as the server, when null) under `limits`. Pure. */
export function wrap(argv: string[], limits: Limits, user: User | null): string[] {
  const prlimit = [
    'prlimit',
    `--as=${limits.addressSpace}`,
    `--fsize=${limits.fileSize}`,
    `--nproc=${limits.processes}`,
    `--nofile=${limits.openFiles}`,
    '--core=0',
    '--',
  ];
  const setpriv = user
    ? ['setpriv', `--reuid=${user.uid}`, `--regid=${user.gid}`, '--clear-groups', '--no-new-privs', '--inh-caps=-all', '--']
    : [];
  return [...prlimit, ...setpriv, ...argv];
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
}

export type Spawner = (argv: string[], opts: { cwd: string; env: Record<string, string>; deadline: number; stdoutLimit: number }) => Promise<RunResult>;

/** Runs argv (no shell) in its own process group and kills the group at the deadline. */
export const spawnWithDeadline: Spawner = (argv, { cwd, env, deadline, stdoutLimit }) =>
  new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, Math.max(0, deadline - Date.now()));
    child.stdout?.on('data', (b: Buffer) => {
      if (size < stdoutLimit) chunks.push(b.subarray(0, stdoutLimit - size));
      size += b.length;
    });
    const done = (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      killGroup();
      resolve({ code, signal, timedOut, stdout: Buffer.concat(chunks).toString('utf8') });
    };
    child.on('error', () => done(127, null));
    child.on('close', (code, signal) => done(code, signal));
  });

/** Kills every process whose real uid is `uid` (left over from a job). Returns how many. */
export function killUserProcesses(uid: number, procRoot = '/proc', kill: (pid: number) => void = (pid) => process.kill(pid, 'SIGKILL')): number {
  let killed = 0;
  let pids: string[];
  try {
    pids = readdirSync(procRoot).filter((d) => /^\d+$/.test(d));
  } catch {
    return 0;
  }
  for (const pid of pids) {
    try {
      const status = readFileSync(path.join(procRoot, pid, 'status'), 'utf8');
      const m = /^Uid:\s+(\d+)/m.exec(status);
      if (m && Number(m[1]) === uid) {
        kill(Number(pid));
        killed++;
      }
    } catch {
      /* the process ended meanwhile */
    }
  }
  return killed;
}

/** Removes every entry owned by `uid` directly inside each of `dirs`. Returns how many. */
export function sweepOwned(dirs: string[], uid: number): number {
  let removed = 0;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(dir, name);
      try {
        if (lstatSync(p).uid === uid) {
          rmSync(p, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* gone meanwhile */
      }
    }
  }
  return removed;
}

/** chown -R, without following links. */
export function chownTree(root: string, uid: number, gid: number): void {
  const st = lstatSync(root);
  if (st.isSymbolicLink()) return;
  chownSync(root, uid, gid);
  if (st.isDirectory()) for (const name of readdirSync(root)) chownTree(path.join(root, name), uid, gid);
}

/**
 * The real path of a file the job wrote, when it is a plain file inside
 * `jobDir`, with one link, owned by `owner` (when given); otherwise null.
 * Called only after the TeX user's processes are killed, so nothing changes
 * it between the check and the read.
 */
export function safeJobFile(jobDir: string, rel: string, owner: number | null): string | null {
  try {
    const root = realpathSync(jobDir);
    const full = path.resolve(root, rel);
    const st = lstatSync(full);
    if (!st.isFile() || st.nlink !== 1) return null;
    if (owner !== null && st.uid !== owner) return null;
    const real = realpathSync(full);
    if (real !== full || !real.startsWith(root + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

/** The last `maxBytes` of a file checked by safeJobFile, as text. */
export function readTail(file: string, maxBytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}
