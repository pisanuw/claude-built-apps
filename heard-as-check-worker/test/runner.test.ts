/**
 * The runner (AC-20, AC-22): a stand-in driver process (a short Node script
 * with the same IPC and stdout contract as driver.ts) is watched, killed on
 * memory, at its limit or when cancelled, and its output is taken as bytes
 * and refused past the cap. No test waits on the clock: the stand-in waits on
 * its stdin or runs until killed (D-31).
 */
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log.ts';
import { DriverRunner, messageFor, type Reason } from '../src/runner.ts';
import { MESSAGES } from '../src/messages.ts';

const cfg = { jobUid: 10002, jobGid: 10002, chrome: '/c', verapdfHome: '/v', pdfjsDir: '/p', sweepDirs: [], cgroupDir: '/nonexistent', jobMs: 90_000 };

/** A driver stand-in running `body` (JavaScript, with `send` and `out` defined). */
function standIn(body: string) {
  return () =>
    spawn(process.execPath, ['-e', `const send=(m)=>new Promise(r=>process.send(m,r)); const out=(s)=>new Promise(r=>process.stdout.write(s,r)); (async()=>{${body}})().then(()=>process.exit(0));`], {
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
      detached: true,
    });
}

function runner(body: string, over: Partial<ConstructorParameters<typeof DriverRunner>[0]> = {}) {
  const lines: string[] = [];
  const cleanup = vi.fn(() => ({ killed: 1, removed: 0 }));
  const r = new DriverRunner({
    cfg,
    staticDir: '/s',
    driverPath: '/d',
    log: createLogger((l) => lines.push(l)),
    spawnDriver: standIn(body),
    read: { job: () => 0, container: () => null },
    cleanup,
    ...over,
  });
  return { r, lines, cleanup };
}

describe('the runner', () => {
  it('takes the output as bytes when the driver says done with the same length, and passes stages on', async () => {
    const out = JSON.stringify({ payloadVersion: 1, text: 'שלום' });
    const { r, cleanup } = runner(`await send({type:'stage',stage:'reading'}); await send({type:'stage',stage:'validating'}); await send({type:'done',bytes:${Buffer.byteLength(out)},summary:{headings:['x']}}); await out(${JSON.stringify(out)});`);
    const stages: string[] = [];
    const res = await r.run({ id: 'a'.repeat(32), file: '/f', jobDir: '/j', verapdf: true, onStage: (s) => stages.push(s) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.toString('utf8')).toBe(out);
    expect(res.summary.driver).toEqual({ headings: ['x'] });
    expect(stages).toEqual(['reading', 'validating']);
    // After every job: the job user's processes killed and its files swept (AC-14).
    expect(cleanup).toHaveBeenCalled();
  });

  it('reports the driver\'s own failure with its words', async () => {
    const { r } = runner(`await send({type:'fail',reason:'password'});`);
    const res = await r.run({ id: 'a'.repeat(32), file: '/f', jobDir: '/j', verapdf: true });
    expect(res).toMatchObject({ ok: false, reason: 'password', message: MESSAGES.password });
  });

  it('is an internal error when the output is short of what the driver said, or the driver dies', async () => {
    const short = runner(`await send({type:'done',bytes:100,summary:{}}); await out('abc');`);
    expect(await short.r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true })).toMatchObject({ ok: false, reason: 'internal' });
    const dies = runner(`process.exit(3);`);
    expect(await dies.r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true })).toMatchObject({ ok: false, reason: 'internal' });
  });

  it('kills the job when its memory passes the threshold, with "needs more memory" (AC-20)', async () => {
    const lines: string[] = [];
    let reads = 0;
    const { r } = runner(`await new Promise(()=>{});`, {
      log: createLogger((l) => lines.push(l)),
      read: { job: () => (++reads > 2 ? 301 * 2 ** 20 : 10 * 2 ** 20), container: () => 200 * 2 ** 20 },
      limits: { sampleMs: 1 },
    });
    const res = await r.run({ id: 'b'.repeat(32), file: '/f', jobDir: '/j', verapdf: true });
    expect(res).toMatchObject({ ok: false, reason: 'memory', message: 'This file needs more memory than the checker has.' });
    expect(res.summary.peakJobBytes).toBe(301 * 2 ** 20);
    expect(lines.some((l) => l.includes('"event":"job-killed"') && l.includes('"reason":"memory"') && l.includes('"jobMB":301'))).toBe(true);
  });

  it('kills the job on the container\'s backstop (AC-20)', async () => {
    const { r } = runner(`await new Promise(()=>{});`, { read: { job: () => 0, container: () => 471 * 2 ** 20 } });
    expect(await r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true })).toMatchObject({ ok: false, reason: 'container-memory', message: MESSAGES.memory });
  });

  it('kills the job at its limit, and when cancelled', async () => {
    const t = runner(`await new Promise(()=>{});`, { cfg: { ...cfg, jobMs: 1 } });
    expect(await t.r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true })).toMatchObject({ ok: false, reason: 'timeout', message: MESSAGES.timeout });
    const c = runner(`await new Promise(()=>{});`);
    const ac = new AbortController();
    const p = c.r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true, signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, reason: 'cancelled' });
    const pre = runner(`await new Promise(()=>{});`);
    const done = new AbortController();
    done.abort();
    expect(await pre.r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true, signal: done.signal })).toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('refuses an output past the cap, without keeping it', async () => {
    const { r } = runner(`await out('x'.repeat(400000)); await new Promise(()=>{});`, { limits: { outputBytes: 1000 } });
    expect(await r.run({ id: 'x', file: '/f', jobDir: '/j', verapdf: true })).toMatchObject({ ok: false, reason: 'output-cap', message: MESSAGES.tooLarge });
  });

  it('passes the driver its arguments: the deadline inside the job\'s limit, the caps and the job user', async () => {
    let seen: Record<string, unknown> = {};
    const r = new DriverRunner({
      cfg,
      staticDir: '/s',
      driverPath: '/d',
      log: createLogger(() => undefined),
      read: { job: () => 0, container: () => null },
      cleanup: () => ({ killed: 0, removed: 0 }),
      spawnDriver: (args) => {
        seen = args as unknown as Record<string, unknown>;
        return standIn(`await send({type:'fail',reason:'unreadable'});`)();
      },
    });
    const t0 = Date.now();
    await r.run({ id: 'x', file: '/j/in.pdf', jobDir: '/j', verapdf: false });
    expect(seen).toMatchObject({ file: '/j/in.pdf', jobDir: '/j', uid: 10002, gid: 10002, outputCap: 20 * 2 ** 20, nodeCap: 24_700, maxPages: 60, verapdf: false });
    expect(seen.deadline as number).toBeLessThanOrEqual(t0 + 89_000 + 1000);
    expect(seen.fontconfigFile).toBeUndefined();
    // Chromium's fontconfig file is passed when the image has it (D-43).
    const r2 = new DriverRunner({
      cfg: { ...cfg, fontconfigFile: __filename },
      staticDir: '/s',
      driverPath: '/d',
      log: createLogger(() => undefined),
      read: { job: () => 0, container: () => null },
      cleanup: () => ({ killed: 0, removed: 0 }),
      spawnDriver: (args) => {
        seen = args as unknown as Record<string, unknown>;
        return standIn(`await send({type:'fail',reason:'unreadable'});`)();
      },
    });
    await r2.run({ id: 'x', file: '/j/in.pdf', jobDir: '/j', verapdf: true, expect: 'Heading' });
    expect(seen).toMatchObject({ fontconfigFile: __filename, expect: 'Heading' });
  });

  it('has words for every reason', () => {
    const all: Reason[] = ['password', 'unreadable', 'output-cap', 'tree-cap', 'timeout', 'memory', 'container-memory', 'cancelled', 'chrome-failed', 'no-sandbox', 'internal'];
    expect(all.map(messageFor)).toEqual([
      MESSAGES.password,
      MESSAGES.unreadable,
      MESSAGES.tooLarge,
      MESSAGES.tooLarge,
      MESSAGES.timeout,
      MESSAGES.memory,
      MESSAGES.memory,
      MESSAGES.cancelled,
      MESSAGES.internal,
      MESSAGES.internal,
      MESSAGES.internal,
    ]);
  });

  it('cleans up with the real functions by default (nothing of the job user runs here)', () => {
    const r = new DriverRunner({ cfg: { ...cfg, jobUid: 999_999 }, staticDir: '/s', driverPath: '/d', log: createLogger(() => undefined) });
    expect(r.cleanup()).toEqual({ killed: 0, removed: 0 });
  });
});
