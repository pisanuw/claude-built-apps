import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderRuntime } from './render-service.mjs';

/** One `key: value` line of a target.yml (this job installs no YAML parser). */
const field = (text, key) => new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1];

test('a Node service keeps its build and start commands (backward compatible)', () => {
  // backend-hub/deploy/target.yml, as the runner reads it.
  const cfg = { build: 'npm run deps && npm ci && npm run build', render: { runtime: 'node', startCommand: 'npm start' } };
  assert.deepEqual(renderRuntime(cfg), {
    env: 'node',
    envSpecificDetails: { buildCommand: 'npm run deps && npm ci && npm run build', startCommand: 'npm start' },
  });
  const hub = readFileSync(new URL('../../backend-hub/deploy/target.yml', import.meta.url), 'utf8');
  assert.equal(field(hub, 'runtime'), 'node');
  assert.equal(field(hub, 'build'), cfg.build);
});

test('no runtime means node, and the start command defaults to npm start', () => {
  assert.deepEqual(renderRuntime({ build: 'npm ci' }), {
    env: 'node',
    envSpecificDetails: { buildCommand: 'npm ci', startCommand: 'npm start' },
  });
});

test('a Docker service sends dockerfilePath and dockerContext, and no commands', () => {
  const out = renderRuntime({
    build: 'ignored',
    render: { runtime: 'docker', dockerfilePath: './Dockerfile.worker', dockerContext: './ctx', startCommand: 'ignored' },
  });
  assert.deepEqual(out, {
    env: 'docker',
    envSpecificDetails: { dockerfilePath: './Dockerfile.worker', dockerContext: './ctx' },
  });
});

test('a Docker service defaults to ./Dockerfile in the root directory', () => {
  assert.deepEqual(renderRuntime({ render: { runtime: 'docker' } }), {
    env: 'docker',
    envSpecificDetails: { dockerfilePath: './Dockerfile', dockerContext: '.' },
  });
});

test("tagging-doctor-worker's target.yml asks for its Dockerfile on the free plan", () => {
  const text = readFileSync(new URL('../../tagging-doctor-worker/deploy/target.yml', import.meta.url), 'utf8');
  assert.equal(field(text, 'provider'), 'render');
  assert.equal(field(text, 'directory'), 'tagging-doctor-worker');
  assert.equal(field(text, 'plan'), 'free');
  assert.equal(field(text, 'build'), undefined);
  const cfg = { render: { runtime: field(text, 'runtime'), dockerfilePath: field(text, 'dockerfilePath'), dockerContext: field(text, 'dockerContext') } };
  assert.deepEqual(renderRuntime(cfg), {
    env: 'docker',
    envSpecificDetails: { dockerfilePath: './Dockerfile', dockerContext: '.' },
  });
});
