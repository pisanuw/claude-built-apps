import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForRenderDeploy, RENDER_DEPLOY_FAILED } from './render-wait.mjs';

/** A fetchStatus that returns the given statuses in turn (the last repeats). */
function statuses(list) {
  let i = 0;
  const fn = async () => {
    const s = list[Math.min(i, list.length - 1)];
    i++;
    if (s instanceof Error) throw s;
    return s;
  };
  fn.calls = () => i;
  return fn;
}

function harness() {
  const slept = [];
  const logs = [];
  return { slept, logs, sleep: async (ms) => { slept.push(ms); }, log: (m) => logs.push(m) };
}

test('goes live after some in-progress statuses', async () => {
  const h = harness();
  const fetchStatus = statuses(['created', 'build_in_progress', 'update_in_progress', 'live']);
  const r = await waitForRenderDeploy({ fetchStatus, sleep: h.sleep, log: h.log });
  assert.deepEqual(r, { ok: true, status: 'live' });
  assert.equal(fetchStatus.calls(), 4);
  assert.deepEqual(h.slept, [15_000, 15_000, 15_000]);
});

test('fails on build_failed without waiting further', async () => {
  const h = harness();
  const fetchStatus = statuses(['build_in_progress', 'build_failed', 'live']);
  const r = await waitForRenderDeploy({ fetchStatus, sleep: h.sleep, log: h.log, label: 'app deploy' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'failed');
  assert.equal(r.status, 'build_failed');
  assert.match(r.message, /app deploy ended with status build_failed/);
  assert.equal(fetchStatus.calls(), 2);
});

test('every failure status ends the wait', async () => {
  for (const s of ['build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed']) {
    assert.ok(RENDER_DEPLOY_FAILED.has(s));
    const r = await waitForRenderDeploy({ fetchStatus: statuses([s]), sleep: async () => {} });
    assert.equal(r.ok, false, s);
    assert.equal(r.reason, 'failed', s);
  }
});

test('times out after about 20 minutes of polling', async () => {
  const h = harness();
  const fetchStatus = statuses(['build_in_progress']);
  const r = await waitForRenderDeploy({ fetchStatus, sleep: h.sleep, log: h.log });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout');
  assert.equal(r.status, 'build_in_progress');
  assert.match(r.message, /not live after ~20 min/);
  assert.equal(h.slept.reduce((a, b) => a + b, 0), 20 * 60_000);
  assert.equal(h.logs.length, 1);
});

test('logs each status change once, not every poll', async () => {
  const h = harness();
  const fetchStatus = statuses([
    undefined, undefined, 'created', 'build_in_progress', 'build_in_progress', 'build_in_progress',
    'update_in_progress', 'update_in_progress', 'live',
  ]);
  const r = await waitForRenderDeploy({ fetchStatus, sleep: h.sleep, log: h.log, label: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(h.logs, [
    'x: status (not reported)',
    'x: status created',
    'x: status build_in_progress',
    'x: status update_in_progress',
    'x: status live',
  ]);
});

test('a transient status error is retried, not fatal', async () => {
  const h = harness();
  const fetchStatus = statuses(['build_in_progress', new Error('HTTP 502'), 'live']);
  const r = await waitForRenderDeploy({ fetchStatus, sleep: h.sleep, log: h.log, label: 'x' });
  assert.equal(r.ok, true);
  assert.equal(h.logs.filter((m) => m.includes('status build_in_progress')).length, 1);
  assert.ok(h.logs.some((m) => m.includes('status check failed (HTTP 502)')));
});
