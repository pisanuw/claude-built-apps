/**
 * AC-42, AC-43 and AC-67 on the worker's image at the CPU of the plan in
 * question 5 (0.5 CPU, 512 MB: backend-hub's instance, the owner's decision
 * of 2026-11-22), with the build flag of AC-80 on: the app's patch and
 * compare code against the real checker, not the live one.
 *
 * - AC-67: math-notes patched with the default fixes (the \DocumentMetadata
 *   line AC-38 inserts, and the engine fix) compiles, and veraPDF's failure
 *   count is lower than the unpatched compile's. The run prints the wall time
 *   and peak memory that DECISIONS.md records, and the clauses left.
 * - AC-42: the two results side by side, with the change per clause.
 * - AC-43: a copy that does not compile (lwarp refuses \DocumentMetadata);
 *   turning off a fix that is not the cause leaves it failing and highlights
 *   nothing; turning off the metadata fix makes it compile, and that card is
 *   the one named, both runs having finished.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkerTakes } from '../src/core/compile';
import { compareJobs, finished, madeItFail } from '../src/core/compare';
import { projectZip } from '../src/core/outzip';
import { applyFixes, suggestFixes } from '../src/core/patch';
import { APP, dropFolder, freshToken, line, REPO, timedRun, Worker } from './common';

const CPUS = process.env.CPUS ?? '0.5';
let w: Worker;
beforeAll(async () => {
  w = await Worker.start({ cpus: CPUS });
});
afterAll(async () => {
  await w?.stop();
});

describe(`on the worker's image at --cpus ${CPUS} --memory 512m`, () => {
  it('AC-67 and AC-42: math-notes patched with the default fixes compiles, with fewer veraPDF failures, side by side', async () => {
    const { project, scan } = dropFolder(path.join(REPO, 'tagging-doctor-worker', 'fixtures', 'math-notes'), 'math-notes.zip');
    const plan = suggestFixes(project, scan);
    const defaults = new Set(plan.cards.filter((c) => c.state === 'ready' && c.acceptedByDefault).map((c) => c.id));
    expect([...defaults]).toEqual(['metadata', 'engine']);
    const patch = applyFixes(project, scan, defaults);
    const token = freshToken();
    const original = await timedRun(w, projectZip(project, { include: checkerTakes }), token);
    const patched = await timedRun(w, projectZip(project, { include: checkerTakes, changes: patch.files }), token);
    console.log(line('AC-67 original', original));
    console.log(line('AC-67 patched', patched));
    expect(original.job.status).toBe('done');
    expect(patched.job.status).toBe('done');
    const c = compareJobs(original.job, patched.job);
    expect(c.patched.failedChecks).toBeLessThan(c.original.failedChecks as number);
    expect(c.trend).toBe('fewer');
    expect(c.rows.some((r) => r.change === 'fixed')).toBe(true);
    for (const r of c.rows) console.log(`AC-42 clause ${r.clause}: original=${r.original ?? '-'} patched=${r.patched ?? '-'} ${r.change} | ${r.words}`);
    const left = c.rows.filter((r) => r.patched !== null).map((r) => `${r.clause} (${r.patched})`);
    console.log(`AC-67 clauses left in the patched copy: ${left.join(', ') || 'none'}; passed=${c.patched.passed}`);
    // Within the checker's 120-second limit at the plan's CPU, and under about 450 MB (AC-65's rule, AC-68).
    expect(patched.jobSeconds).toBeLessThan(90);
    expect(patched.peakRssMb).toBeLessThan(450);
  });

  it('AC-43: turning off a fix and compiling again; the fix whose removal made it compile is the one named', async () => {
    const { project, scan } = dropFolder(path.join(APP, 'image-test', 'fixtures', 'lwarp'), 'week3.zip');
    const token = freshToken();
    const zipFor = (ids: Set<string>) => projectZip(project, { include: checkerTakes, changes: applyFixes(project, scan, ids).files });
    const both = new Set(['metadata', 'engine']);
    const first = await timedRun(w, zipFor(both), token);
    console.log(line('AC-43 metadata+engine', first));
    expect(first.job.status).toBe('failed');
    expect(finished(first.job)).toBe(true);
    // The engine fix off: still fails, so nothing is named.
    const metadataOnly = new Set(['metadata']);
    const second = await timedRun(w, zipFor(metadataOnly), token);
    console.log(line('AC-43 metadata', second));
    expect(second.job.status).toBe('failed');
    expect(madeItFail({ accepted: both, job: first.job }, { accepted: metadataOnly, job: second.job })).toBeNull();
    // The metadata fix off (from the first set): it compiles, and the metadata card is the one named.
    const engineOnly = new Set(['engine']);
    const third = await timedRun(w, zipFor(engineOnly), token);
    console.log(line('AC-43 engine', third));
    expect(third.job.status).toBe('done');
    expect(madeItFail({ accepted: both, job: first.job }, { accepted: engineOnly, job: third.job })).toBe('metadata');
    // The plan names the cards the page shows for it.
    expect(suggestFixes(project, scan).cards.filter((c) => c.state === 'ready').map((c) => c.id)).toEqual(['metadata', 'engine', 'unicode-math']);
  });
});
