/**
 * The job user's processes and files (AC-14). The capture and veraPDF run as
 * a user of the mount's own (uid 10002 in the image: neither root nor 10001,
 * the checker's TeX user). After every job, every process of that uid is
 * killed and its files directly in /tmp, /var/tmp and /dev/shm are removed;
 * the checker does the same for uid 10001 only, so neither touches the other.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

/** The pids whose real uid is `uid`. */
export function pidsOf(uid: number, procRoot = '/proc'): number[] {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const m = /^Uid:\s+(\d+)/m.exec(readFileSync(path.join(procRoot, name, 'status'), 'utf8'));
      if (m && Number(m[1]) === uid) out.push(Number(name));
    } catch {
      /* the process ended meanwhile */
    }
  }
  return out;
}

/** Kills every process whose real uid is `uid`. Returns how many. Refuses root and the checker's TeX user. */
export function killUid(uid: number, procRoot = '/proc', kill: (pid: number) => void = (pid) => process.kill(pid, 'SIGKILL')): number {
  if (uid === 0 || uid === 10001) throw new Error('refusing to kill root\'s or the checker\'s processes');
  let killed = 0;
  for (const pid of pidsOf(uid, procRoot)) {
    try {
      kill(pid);
      killed++;
    } catch {
      /* gone */
    }
  }
  return killed;
}

/** True when a `status` text is a live task (not a zombie or dead) with `uid` as its real, effective, saved or file uid. Pure. */
export function liveTaskOf(status: string, uid: number): boolean {
  const state = /^State:\s+(\S)/m.exec(status)?.[1];
  if (state === 'Z' || state === 'X' || state === 'x') return false;
  const ids = /^Uid:\s+(.+)$/m.exec(status)?.[1].trim().split(/\s+/).map(Number) ?? [];
  return ids.includes(uid);
}

/**
 * The pids with a live task of `uid` (any thread, any of its uids; R2.1-2).
 * A zombie is not counted: it runs nothing and holds no file.
 */
export function liveProcessesOf(uid: number, procRoot = '/proc'): number[] {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let tasks: string[];
    try {
      tasks = readdirSync(path.join(procRoot, name, 'task'));
    } catch {
      tasks = [];
    }
    const files = tasks.length ? tasks.map((t) => path.join(procRoot, name, 'task', t, 'status')) : [path.join(procRoot, name, 'status')];
    for (const f of files) {
      try {
        if (liveTaskOf(readFileSync(f, 'utf8'), uid)) {
          out.push(Number(name));
          break;
        }
      } catch {
        /* the task ended meanwhile */
      }
    }
  }
  return out;
}

/**
 * Kills every process of `uid` from inside the uid: `kill -KILL -1` run as
 * that user reaches every process it may signal, children forked a moment
 * ago included, which a scan of /proc from outside can miss (R2.1-2,
 * D-48). The helper runs at most 2 s and is killed by root if it hangs.
 */
export function killAsUser(uid: number, gid: number, run: typeof spawnSync = spawnSync): void {
  if (uid === 0 || uid === 10001) throw new Error('refusing to kill root\'s or the checker\'s processes');
  run('setpriv', [`--reuid=${uid}`, `--regid=${gid}`, '--clear-groups', '--', 'kill', '-s', 'KILL', '--', '-1'], { stdio: 'ignore', timeout: 2_000, killSignal: 'SIGKILL' });
}

export interface StopDeps {
  procRoot?: string;
  /** Kills from inside the uid (killAsUser). */
  killAs?: (uid: number, gid: number) => void;
  /** Kills one pid as root. */
  kill?: (pid: number) => void;
  pause?: (ms: number) => Promise<void>;
  passes?: number;
}

/**
 * Stops every process of the job user and checks that none is left
 * (R2.1-2, D-48): each pass kills from inside the uid and by pid as root,
 * then reads every task again. `clear` is false when a live task of the uid
 * is still there after the last pass: the caller then fails closed (no
 * delete of the user's folders, no further job).
 */
export async function stopUid(uid: number, gid: number, d: StopDeps = {}): Promise<{ clear: boolean; killed: number; passes: number }> {
  if (uid === 0 || uid === 10001) throw new Error('refusing to kill root\'s or the checker\'s processes');
  const procRoot = d.procRoot ?? '/proc';
  const killAs = d.killAs ?? killAsUser;
  const kill = d.kill ?? ((pid: number) => process.kill(pid, 'SIGKILL'));
  const pause = d.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const passes = d.passes ?? 10;
  let killed = 0;
  for (let pass = 0; pass < passes; pass++) {
    const live = liveProcessesOf(uid, procRoot);
    if (live.length === 0) return { clear: true, killed, passes: pass };
    try {
      killAs(uid, gid);
    } catch {
      /* no setpriv: the kill by pid below still runs */
    }
    for (const pid of live) {
      try {
        kill(pid);
        killed++;
      } catch {
        /* gone */
      }
    }
    await pause(50);
  }
  return { clear: liveProcessesOf(uid, procRoot).length === 0, killed, passes };
}

/** Removes every entry owned by `uid` directly inside each of `dirs`. Returns how many. */
export function sweepOwned(dirs: string[], uid: number): number {
  if (uid === 0 || uid === 10001) throw new Error('refusing to sweep root\'s or the checker\'s files');
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

/** The argv that runs `argv` as `uid:gid` with no supplementary groups. `noNewPrivs` only where no sandbox helper needs privileges (veraPDF, not Chromium: AC-14). */
export function asUser(argv: string[], uid: number, gid: number, noNewPrivs: boolean): string[] {
  return ['setpriv', `--reuid=${uid}`, `--regid=${gid}`, '--clear-groups', ...(noNewPrivs ? ['--no-new-privs'] : []), '--inh-caps=-all', '--', ...argv];
}
