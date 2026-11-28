/** AC-20, SPEC section 3: how memory is measured, and the monitor that kills a job. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { containerMemory, findCgroup, jobMemory, Monitor, processMemory } from '../src/memory.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'hac-mem-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MB = 2 ** 20;

function proc(entries: { pid: number; uid: number; rollup?: string; status?: string }[]): string {
  const root = tmp();
  for (const e of entries) {
    mkdirSync(path.join(root, String(e.pid)));
    writeFileSync(path.join(root, String(e.pid), 'status'), `Name:\tchrome\nUid:\t${e.uid}\t${e.uid}\t${e.uid}\t${e.uid}\n${e.status ?? ''}`);
    if (e.rollup !== undefined) writeFileSync(path.join(root, String(e.pid), 'smaps_rollup'), e.rollup);
  }
  return root;
}

describe('the job\'s memory: non-file, summed over the job user\'s processes at one instant', () => {
  it('reads Pss_Anon + Pss_Shmem where smaps_rollup is readable, and leaves Pss_File out', () => {
    const root = proc([{ pid: 1, uid: 10002, rollup: 'Rss: 9000 kB\nPss: 8000 kB\nPss_Anon: 3000 kB\nPss_File: 4000 kB\nPss_Shmem: 1000 kB\n', status: 'RssAnon:\t9999 kB\nRssShmem:\t9999 kB\n' }]);
    expect(processMemory(1, root)).toEqual({ bytes: 4000 * 1024, pss: true });
  });

  it('falls back to RssAnon + RssShmem from status when smaps_rollup cannot be read (root in the container, S3-7)', () => {
    const root = proc([{ pid: 2, uid: 10002, status: 'RssAnon:\t2048 kB\nRssFile:\t50000 kB\nRssShmem:\t1024 kB\n' }]);
    expect(processMemory(2, root)).toEqual({ bytes: 3072 * 1024, pss: false });
    // A rollup without the split fields (an old kernel) falls back too.
    const old = proc([{ pid: 3, uid: 10002, rollup: 'Pss: 100 kB\n', status: 'RssAnon:\t10 kB\n' }]);
    expect(processMemory(3, old)).toEqual({ bytes: 10 * 1024, pss: false });
    expect(processMemory(4, old)).toBeNull();
  });

  it('sums only the job user\'s processes', () => {
    const root = proc([
      { pid: 10, uid: 10002, rollup: 'Pss_Anon: 100000 kB\nPss_Shmem: 0 kB\n' },
      { pid: 11, uid: 10002, status: 'RssAnon:\t50000 kB\nRssShmem:\t2000 kB\n' },
      { pid: 12, uid: 10001, status: 'RssAnon:\t900000 kB\n' },
      { pid: 13, uid: 0, status: 'RssAnon:\t900000 kB\n' },
    ]);
    expect(jobMemory(10002, root)).toEqual({ bytes: 152000 * 1024, processes: 2, pss: 1, fallback: 1 });
  });
});

describe('the container\'s memory: non-reclaimable, page cache left out', () => {
  it('reads total_rss + total_shmem under cgroup v1', () => {
    const d = tmp();
    writeFileSync(path.join(d, 'memory.usage_in_bytes'), String(500 * MB));
    writeFileSync(path.join(d, 'memory.stat'), `cache ${400 * MB}\nrss 1\nshmem 2\ntotal_cache ${400 * MB}\ntotal_rss ${300 * MB}\ntotal_shmem ${5 * MB}\n`);
    const cg = findCgroup(d);
    expect(cg).toEqual({ version: 'v1', dir: d });
    expect(containerMemory(cg)).toBe(305 * MB);
  });

  it('reads anon + shmem under cgroup v2', () => {
    const d = tmp();
    writeFileSync(path.join(d, 'memory.stat'), `anon ${200 * MB}\nfile ${300 * MB}\nshmem ${7 * MB}\n`);
    const cg = findCgroup(d);
    expect(cg?.version).toBe('v2');
    expect(containerMemory(cg)).toBe(207 * MB);
  });

  it('gives null when memory.stat is missing or lacks the fields', () => {
    const d = tmp();
    expect(findCgroup(d)).toBeNull();
    expect(containerMemory(null)).toBeNull();
    expect(containerMemory({ version: 'v2', dir: d })).toBeNull();
    writeFileSync(path.join(d, 'memory.stat'), 'anon 5\n');
    expect(containerMemory({ version: 'v2', dir: d })).toBeNull();
  });
});

describe('the monitor', () => {
  function monitor(job: number[], container: (number | null)[]) {
    const onKill = vi.fn();
    let i = 0;
    const m = new Monitor({
      uid: 10002,
      jobLimit: 300 * MB,
      containerLimit: 470 * MB,
      periodMs: 100,
      cgroup: null,
      onKill,
      read: { job: () => job[Math.min(i, job.length - 1)], container: () => container[Math.min(i++, container.length - 1)] },
    });
    return { m, onKill };
  }

  it('kills once when the job passes 300 MB, and records the peaks and the largest gap between samples', () => {
    const { m, onKill } = monitor([100 * MB, 250 * MB, 301 * MB, 400 * MB], [200 * MB, 300 * MB, 400 * MB, 450 * MB]);
    m.tick(0);
    m.tick(100);
    expect(onKill).not.toHaveBeenCalled();
    m.tick(230);
    expect(onKill).toHaveBeenCalledWith('memory', { job: 301 * MB, container: 400 * MB });
    m.tick(330);
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(m.killed).toBe('memory');
    expect(m.peakJob).toBe(400 * MB);
    expect(m.peakContainer).toBe(450 * MB);
    expect(m.maxGapMs).toBe(130);
    expect(m.samples).toBe(4);
  });

  it('a job exactly at the threshold is not killed (a file within the limits never is)', () => {
    const { m, onKill } = monitor([300 * MB], [100 * MB]);
    m.tick(0);
    expect(onKill).not.toHaveBeenCalled();
  });

  it('kills on the container\'s backstop at 470 MB whatever the cause, and not when memory.stat cannot be read', () => {
    const a = monitor([50 * MB], [471 * MB]);
    a.m.tick(0);
    expect(a.onKill).toHaveBeenCalledWith('container-memory', { job: 50 * MB, container: 471 * MB });
    const b = monitor([50 * MB], [null]);
    b.m.tick(0);
    expect(b.onKill).not.toHaveBeenCalled();
    expect(b.m.peakContainer).toBe(0);
  });

  it('samples on a timer until stopped', async () => {
    const reads: number[] = [];
    const m = new Monitor({ uid: 10002, jobLimit: 1, containerLimit: 1, periodMs: 1, cgroup: null, onKill: () => undefined, read: { job: () => (reads.push(1), 0), container: () => 0 } });
    m.start();
    while (reads.length < 3) await new Promise((r) => setImmediate(r));
    m.stop();
    m.stop();
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });

  it('reads /proc and the cgroup by default', () => {
    const m = new Monitor({ uid: 999_999, jobLimit: 1, containerLimit: 10 ** 15, periodMs: 100, cgroup: findCgroup(), onKill: vi.fn() });
    m.tick();
    expect(m.peakJob).toBe(0);
  });
});
