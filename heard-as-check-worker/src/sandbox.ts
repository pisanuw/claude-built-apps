/**
 * The job user's processes and files (AC-14). The capture and veraPDF run as
 * a user of the mount's own (uid 10002 in the image: neither root nor 10001,
 * the checker's TeX user). After every job, every process of that uid is
 * killed and its files directly in /tmp, /var/tmp and /dev/shm are removed;
 * the checker does the same for uid 10001 only, so neither touches the other.
 */
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
