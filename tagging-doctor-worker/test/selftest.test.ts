import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunResult, Spawner } from '../src/sandbox.ts';
import { canCompile, jobUser, selfTest } from '../src/selftest.ts';

let root = '';
beforeEach(() => (root = mkdtempSync(path.join(tmpdir(), 'tdw-st-'))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

function spawner(answers: Record<string, (argv: string[]) => Partial<RunResult>>): Spawner {
  return async (argv) => {
    const cmd = argv[argv.lastIndexOf('--') + 1];
    if (cmd === 'cat') expect(existsSync(argv.at(-1) as string)).toBe(true);
    return { code: 0, signal: null, timedOut: false, stdout: '', ...(answers[cmd]?.(argv) ?? {}) };
  };
}
const user = { uid: 10001, gid: 10001 };
const base = { jobsRoot: '', texBin: '/tex', serverUid: 0, now: () => 0 };

describe('AC-64: the startup self-test', () => {
  it('passes when TeX runs as the TeX user and cannot read a file of the server', async () => {
    const r = await selfTest({
      ...base,
      jobsRoot: root,
      user,
      spawner: spawner({ id: () => ({ stdout: '10001\n' }), cat: () => ({ code: 1, stdout: '' }), lualatex: () => ({ stdout: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)' }) }),
    });
    expect(r).toEqual({ serverUid: 0, texUid: 10001, checkedAt: '1970-01-01T00:00:00.000Z', separateUser: true, texRuns: true, serverFileHidden: true });
    expect(readdirSync(root)).toEqual([]); // the planted file is removed
  });

  it('fails when the uid did not change, or the file could be read', async () => {
    const same = await selfTest({ ...base, jobsRoot: root, user, spawner: spawner({ id: () => ({ stdout: '0\n' }), cat: () => ({ code: 1 }) }) });
    expect(same.separateUser).toBe(false);
    const read = await selfTest({ ...base, jobsRoot: root, user, spawner: spawner({ id: () => ({ stdout: '10001' }), cat: () => ({ code: 0 }) }) });
    expect(read).toMatchObject({ separateUser: false, serverFileHidden: false });
    const cannot = await selfTest({ ...base, jobsRoot: root, user, spawner: spawner({ id: () => ({ code: 1 }), cat: () => ({ code: 1 }), lualatex: () => ({ code: 127 }) }) });
    expect(cannot).toMatchObject({ separateUser: false, texRuns: false });
  });

  it('says so when no TeX user is set', async () => {
    const r = await selfTest({ ...base, jobsRoot: root, user: null, spawner: spawner({}) });
    expect(r).toMatchObject({ separateUser: false, texUid: null, texRuns: false });
  });
});

describe('R3a.3-3 (a): jobs get the TeX user only when a compile is possible', () => {
  it('needs both a user of its own and a TeX that runs as it', () => {
    for (const [separateUser, texRuns, can] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]] as const) {
      expect(canCompile({ separateUser, texRuns }), `${separateUser} ${texRuns}`).toBe(can);
      expect(jobUser({ separateUser, texRuns }, user), `${separateUser} ${texRuns}`).toBe(can ? user : null);
    }
    expect(jobUser({ separateUser: true, texRuns: true }, null)).toBeNull();
  });
});
