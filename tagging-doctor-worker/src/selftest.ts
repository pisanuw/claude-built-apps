/**
 * AC-64's startup self-test: does TeX run under another uid than the server,
 * and can that user not read a file only the server user can read? The
 * health route shows the result (AC-36). Unless TeX runs as a user of its
 * own (`separateUser`) and runs at all (`texRuns`), the worker takes no job
 * and the health route says `compile: false` (D-68, R3a.2-3).
 */
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEX_LIMITS, wrap, type Spawner, type User } from './sandbox.ts';

export interface SelfTest {
  separateUser: boolean;
  serverUid: number;
  texUid: number | null;
  /** True when `lualatex --version` ran as the TeX user. */
  texRuns: boolean;
  /** True when the TeX user could not read a file of the server user's. */
  serverFileHidden: boolean;
  checkedAt: string;
}

/** True when TeX runs as a user of its own and runs at all: only then is a job taken (D-68, R3a.2-3 b). */
export function canCompile(test: Pick<SelfTest, 'separateUser' | 'texRuns'>): boolean {
  return test.separateUser && test.texRuns;
}

/**
 * The user jobs run as: the wanted TeX user when `canCompile`, else none, so
 * the queue's `maxWaiting` is 0 exactly when health says `compile: false`
 * (R3a.3-3 a).
 */
export function jobUser(test: Pick<SelfTest, 'separateUser' | 'texRuns'>, wanted: User | null): User | null {
  return canCompile(test) ? wanted : null;
}

export async function selfTest(opts: {
  user: User | null;
  jobsRoot: string;
  texBin: string;
  spawner: Spawner;
  serverUid: number;
  now?: () => number;
}): Promise<SelfTest> {
  const now = opts.now ?? Date.now;
  const base = { serverUid: opts.serverUid, texUid: opts.user?.uid ?? null, checkedAt: new Date(now()).toISOString() };
  if (!opts.user) return { ...base, separateUser: false, texRuns: false, serverFileHidden: false };
  const env = { PATH: `${opts.texBin}:/usr/bin:/bin`, LANG: 'C.UTF-8', HOME: '/nonexistent' };
  const run = (argv: string[]) =>
    opts.spawner(wrap(argv, TEX_LIMITS, opts.user), { cwd: '/', env, deadline: now() + 30_000, stdoutLimit: 64 * 1024 });
  const secret = randomBytes(16).toString('hex');
  const planted = path.join(opts.jobsRoot, '.self-test');
  writeFileSync(planted, secret, { mode: 0o600 });
  try {
    const id = await run(['id', '-u']);
    const uid = id.code === 0 ? Number(id.stdout.trim()) : NaN;
    const read = await run(['cat', planted]);
    const serverFileHidden = read.code !== 0 && !read.stdout.includes(secret);
    const tex = await run(['lualatex', '--version']);
    const texRuns = tex.code === 0 && /LuaHBTeX|LuaTeX/.test(tex.stdout);
    return { ...base, separateUser: uid === opts.user.uid && uid !== opts.serverUid && serverFileHidden, texRuns, serverFileHidden };
  } finally {
    rmSync(planted, { force: true });
  }
}
