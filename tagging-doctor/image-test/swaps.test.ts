/**
 * AC-40: each swap in src/data/package-swaps.json with a replacement has a
 * fixture project and a recorded result. This test compiles each fixture on
 * the worker's image, with tagging on, as it is and with the swap the app's
 * own patch makes, and checks the record: the swapped copy compiles with
 * LuaLaTeX and veraPDF's failed checks do not rise. With WRITE_SWAP_RECORDS=1
 * it writes the records instead (the date is the run's).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkerTakes, type CheckerJob } from '../src/core/compile';
import { projectZip } from '../src/core/outzip';
import { applyFixes, type SwapRecord } from '../src/core/patch';
import { APP, dropFolder, freshToken, REPO, timedRun, Worker } from './common';

const FILE = path.join(APP, 'src', 'data', 'package-swaps.json');
const table = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: { from: string; to: string | null; fixture?: string; record?: SwapRecord | null }[] };
const WRITE = process.env.WRITE_SWAP_RECORDS === '1';

let w: Worker;
beforeAll(async () => {
  w = await Worker.start({ cpus: process.env.CPUS });
});
afterAll(async () => {
  await w?.stop();
});

const side = (j: CheckerJob) => ({ compiled: j.status === 'done', failedChecks: j.status === 'done' ? (j.result?.validation?.failedChecks ?? null) : null });

describe('AC-40: the swap records', () => {
  const tested = table.entries.filter((e) => e.to && e.fixture);
  it.each(tested.map((e) => [e.from, e] as const))('%s', async (_name, e) => {
    const { project, scan } = dropFolder(path.join(REPO, e.fixture as string));
    // The swap as the app makes it: the same table, this entry passing, its card alone accepted.
    const asPassing = table.entries.map((x) => (x === e ? { ...x, record: { date: '-', before: { compiled: true, failedChecks: 0 }, after: { compiled: true, failedChecks: 0 }, passed: true } } : x));
    const patch = applyFixes(project, scan, new Set([`swap:${e.from}`]), {}, asPassing as never);
    expect(patch.applied).toEqual([`swap:${e.from}`]);
    expect([...patch.files.values()].join('\n')).toContain(`{${e.to}}`);
    const token = freshToken();
    const before = await timedRun(w, projectZip(project, { include: checkerTakes }), token);
    const after = await timedRun(w, projectZip(project, { include: checkerTakes, changes: patch.files }), token);
    const b = side(before.job);
    const a = side(after.job);
    const passed = a.compiled && (!b.compiled || (a.failedChecks ?? Infinity) <= (b.failedChecks ?? Infinity));
    console.log(`SWAP ${e.from} -> ${e.to}: before ${JSON.stringify(b)} after ${JSON.stringify(a)} passed=${passed}`);
    if (WRITE) {
      e.record = { date: new Date().toISOString().slice(0, 10), before: b, after: a, passed };
      writeFileSync(FILE, `${JSON.stringify(table, null, 2)}\n`);
      return;
    }
    expect(e.record, `${e.from} has no record; run with WRITE_SWAP_RECORDS=1`).toBeTruthy();
    expect({ before: b, after: a, passed }).toEqual({ before: e.record?.before, after: e.record?.after, passed: e.record?.passed });
  });
});
