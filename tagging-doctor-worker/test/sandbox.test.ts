import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chownTree, JAVA_LIMITS, killUserProcesses, readTail, safeJobFile, spawnWithDeadline, sweepOwned, TEX_LIMITS, wrap } from '../src/sandbox.ts';

const me = process.getuid?.() ?? 0;
const myGid = process.getgid?.() ?? 0;
let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tdw-sb-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('AC-64: how TeX is run', () => {
  it('runs as the TeX user under rlimits, without a shell', () => {
    expect(wrap(['lualatex', './main.tex'], TEX_LIMITS, { uid: 10001, gid: 10001 })).toEqual([
      'prlimit', '--as=419430400', '--fsize=209715200', '--nproc=64', '--nofile=256', '--core=0', '--',
      'setpriv', '--reuid=10001', '--regid=10001', '--clear-groups', '--no-new-privs', '--inh-caps=-all', '--',
      'lualatex', './main.tex',
    ]);
    expect(wrap(['java'], JAVA_LIMITS, null)).toEqual(['prlimit', '--as=unlimited', '--fsize=209715200', '--nproc=64', '--nofile=256', '--core=0', '--', 'java']);
  });

  it('spawns with only the given environment, and keeps stdout up to a limit', async () => {
    const r = await spawnWithDeadline([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.env))'], {
      cwd: dir,
      env: { ONLY: 'this' },
      deadline: Date.now() + 10_000,
      stdoutLimit: 1 << 20,
    });
    expect(r.code).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(JSON.parse(r.stdout)).toEqual({ ONLY: 'this' });
    const cut = await spawnWithDeadline([process.execPath, '-e', 'process.stdout.write("x".repeat(100000))'], { cwd: dir, env: {}, deadline: Date.now() + 10_000, stdoutLimit: 10 });
    expect(cut.stdout).toBe('xxxxxxxxxx');
  });

  it('kills the whole process group at the deadline', async () => {
    const t0 = Date.now();
    const r = await spawnWithDeadline([process.execPath, '-e', 'require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{stdio:"ignore"}); setTimeout(()=>{},60000)'], {
      cwd: dir,
      env: {},
      deadline: Date.now() + 300,
      stdoutLimit: 100,
    });
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe('SIGKILL');
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('R3a.1-6: kills the process group when the job is deleted', async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const p = spawnWithDeadline([process.execPath, '-e', 'setTimeout(()=>{},60000)'], { cwd: dir, env: {}, deadline: Date.now() + 60_000, stdoutLimit: 10, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const r = await p;
    expect(r.signal).toBe('SIGKILL');
    expect(r.timedOut).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
    const pre = new AbortController();
    pre.abort();
    expect((await spawnWithDeadline([process.execPath, '-e', 'setTimeout(()=>{},60000)'], { cwd: dir, env: {}, deadline: Date.now() + 60_000, stdoutLimit: 10, signal: pre.signal })).signal).toBe('SIGKILL');
  });

  it('reports a command that cannot start', async () => {
    const r = await spawnWithDeadline(['/no/such/binary'], { cwd: dir, env: {}, deadline: Date.now() + 5000, stdoutLimit: 10 });
    expect(r.code).toBe(127);
  });
});

describe('after a job', () => {
  it("kills every process of the TeX user's uid", () => {
    for (const [pid, uid] of [['11', 10001], ['12', 0], ['13', 10001]] as const) {
      mkdirSync(path.join(dir, pid));
      writeFileSync(path.join(dir, pid, 'status'), `Name:\tx\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
    }
    mkdirSync(path.join(dir, 'self'));
    mkdirSync(path.join(dir, '14')); // ended meanwhile: no status
    const killed: number[] = [];
    expect(killUserProcesses(10001, dir, (pid) => killed.push(pid))).toBe(2);
    expect(killed.sort()).toEqual([11, 13]);
    expect(killUserProcesses(10001, path.join(dir, 'missing'))).toBe(0);
  });

  it("removes the TeX user's files from the shared folders, and nothing else", () => {
    mkdirSync(path.join(dir, 'shm'));
    writeFileSync(path.join(dir, 'shm', 'left.txt'), 'x');
    mkdirSync(path.join(dir, 'shm', 'leftdir'));
    expect(sweepOwned([path.join(dir, 'shm'), path.join(dir, 'missing')], me + 1)).toBe(0);
    expect(sweepOwned([path.join(dir, 'shm')], me)).toBe(2);
    expect(existsSync(path.join(dir, 'shm', 'left.txt'))).toBe(false);
  });

  it('gives a job folder to the TeX user, without following links', () => {
    mkdirSync(path.join(dir, 'job', 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'job', 'src', 'main.tex'), 'x');
    symlinkSync('/etc/hostname', path.join(dir, 'job', 'link'));
    chownTree(path.join(dir, 'job'), me, myGid);
    expect(statSync(path.join(dir, 'job', 'src', 'main.tex')).uid).toBe(me);
  });
});

describe("reading what a job wrote: only its own plain files", () => {
  it('accepts a plain file inside the job, of the right owner', () => {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'main.log'), 'line1\nline2\n');
    const f = safeJobFile(dir, 'src/main.log', me);
    expect(f).toBe(path.join(dir, 'src', 'main.log'));
    expect(readTail(f as string, 6)).toBe('line2\n');
    expect(safeJobFile(dir, 'src/main.log', null)).not.toBeNull();
  });

  it('refuses a link to a file of the server, a hard link, a folder, a missing file, another owner and a path outside', () => {
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'secret'), 'SECRET');
    symlinkSync(path.join(dir, 'secret'), path.join(dir, 'src', 'main.log'));
    linkSync(path.join(dir, 'secret'), path.join(dir, 'src', 'main.pdf'));
    writeFileSync(path.join(dir, 'src', 'ok.aux'), '');
    mkdirSync(path.join(dir, 'src', 'main.bcf'));
    symlinkSync(path.join(dir, 'src'), path.join(dir, 'via'));
    expect(safeJobFile(dir, 'src/main.log', me)).toBeNull();
    expect(safeJobFile(dir, 'src/main.pdf', me)).toBeNull();
    expect(safeJobFile(dir, 'src/main.bcf', me)).toBeNull();
    expect(safeJobFile(dir, 'src/none.blg', me)).toBeNull();
    expect(safeJobFile(dir, 'src/ok.aux', me + 1)).toBeNull();
    expect(safeJobFile(dir, 'via/ok.aux', me)).toBeNull();
    expect(safeJobFile(path.join(dir, 'src'), '../secret', me)).toBeNull();
  });
});
