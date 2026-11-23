import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderBuildFilter, renderRootDir, renderRuntime, renderServicePatch } from './render-service.mjs';

/** One `key: value` line of a target.yml (this job installs no YAML parser). */
const field = (text, key) => new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1];

test('a Node service keeps its build and start commands (backward compatible)', () => {
  // backend-hub/deploy/target.yml before CR-13, as the runner read it.
  const cfg = { build: 'npm run deps && npm ci && npm run build', render: { runtime: 'node', startCommand: 'npm start' } };
  assert.deepEqual(renderRuntime(cfg), {
    env: 'node',
    envSpecificDetails: { buildCommand: 'npm run deps && npm ci && npm run build', startCommand: 'npm start' },
  });
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

test("tagging-doctor-worker's target.yml is gone (CR-13, AC-36): the Deploy workflow neither recreates nor rebuilds the free service", () => {
  assert.equal(existsSync(new URL('../../tagging-doctor-worker/deploy/target.yml', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../tagging-doctor-worker/Dockerfile', import.meta.url)), true); // the checker's code and image stay
});

// --- An existing service (D-108): what the runner changes besides the plan and the env ---

/** The `- item` lines under `key:` (this job installs no YAML parser). */
const listAfter = (text, key) => {
  const m = new RegExp(`^(\\s*)${key}:\\s*\\n((?:\\1\\s+- .*\\n)+)`, 'm').exec(text);
  return m ? m[2].split('\n').filter(Boolean).map((l) => l.replace(/^\s*- /, '').replace(/^'(.*)'$/, '$1')) : undefined;
};
const unquote = (v) => v?.replace(/^'(.*)'$/, '$1');
/** backend-hub/deploy/target.yml, read field by field into the shape the runner gets from its YAML parser. */
function hubYml() {
  const text = readFileSync(new URL('../../backend-hub/deploy/target.yml', import.meta.url), 'utf8');
  const f = (k) => unquote(field(text, k));
  return {
    provider: f('provider'),
    projectName: f('projectName'),
    directory: f('directory'),
    build: f('build'),
    env: { IDLE_MINUTES: f('IDLE_MINUTES'), FROM_EMAIL: f('FROM_EMAIL'), TAGGING_DOCTOR_SUPABASE_URL: f('TAGGING_DOCTOR_SUPABASE_URL'), ...(field(text, 'TAGGING_DOCTOR_CHECKER') ? { TAGGING_DOCTOR_CHECKER: 'set' } : {}) },
    envPassthrough: listAfter(text, 'envPassthrough'),
    render: {
      runtime: f('runtime'),
      rootDir: f('rootDir'),
      dockerfilePath: f('dockerfilePath'),
      dockerContext: f('dockerContext'),
      plan: f('plan'),
      region: f('region'),
      healthCheckPath: f('healthCheckPath'),
      generateEnv: listAfter(text, 'generateEnv'),
      buildFilter: { paths: listAfter(text, 'paths'), ignoredPaths: listAfter(text, 'ignoredPaths') },
    },
  };
}
/** backend-hub as Render reports it before the switch (GET /services?name=backend-hub). */
const nativeHub = {
  id: 'srv-hub',
  rootDir: 'backend-hub',
  serviceDetails: { env: 'node', runtime: 'node', plan: '0.5c-512mb', envSpecificDetails: { buildCommand: 'npm run deps && npm ci && npm run build', startCommand: 'npm start' } },
};

test("backend-hub's target.yml: a Docker image from backend-hub/Dockerfile, the repository's root as context and root directory, a build filter", () => {
  const cfg = hubYml();
  assert.equal(cfg.provider, 'render');
  assert.equal(cfg.projectName, 'backend-hub');
  assert.equal(cfg.build, undefined);
  assert.equal(cfg.render.plan, '0.5c-512mb'); // no new plan (CR-13)
  assert.equal(cfg.render.region, 'oregon');
  assert.equal(cfg.render.healthCheckPath, '/api/health'); // the hub's own
  assert.deepEqual(renderRuntime(cfg), { env: 'docker', envSpecificDetails: { dockerfilePath: './backend-hub/Dockerfile', dockerContext: '.' } });
  assert.equal(renderRootDir(cfg), '');
  const f = renderBuildFilter(cfg);
  for (const p of ['backend-hub/**', 'mult-streak/**', 'tagging-doctor-worker/src/**', 'tagging-doctor-worker/docker/**', 'scripts/site-footer.mjs']) assert.ok(f.paths.includes(p), p);
  assert.ok(!f.paths.some((p) => p === '**' || p.startsWith('tagging-doctor/')), 'the app and the rest of the repository do not rebuild the hub');
  assert.equal(cfg.env.TAGGING_DOCTOR_SUPABASE_URL, 'https://auth.hintwise.org');
  assert.ok(!('TAGGING_DOCTOR_CHECKER' in cfg.env), 'the image names the checker');
  // mult-streak's env is as it was.
  assert.equal(cfg.env.IDLE_MINUTES, '5');
  assert.equal(cfg.env.FROM_EMAIL, 'mult-streak@hintwise.org');
  assert.deepEqual(cfg.envPassthrough, ['RESEND_API', 'ADMIN_EMAIL', 'COOKIE_SECRET']);
  assert.deepEqual(cfg.render.generateEnv, ['COOKIE_SECRET']);
});

test('the native backend-hub becomes Docker in one update: runtime, Docker details, root directory and build filter', () => {
  const cfg = hubYml();
  const out = renderServicePatch(nativeHub, cfg);
  assert.deepEqual(out.patch, {
    serviceDetails: { runtime: 'docker', envSpecificDetails: { dockerfilePath: './backend-hub/Dockerfile', dockerContext: '.' } },
    rootDir: '',
    buildFilter: renderBuildFilter(cfg),
  });
  assert.deepEqual(out.changes.map((c) => c.split(' ')[0]), ['runtime', 'rootDir', 'buildFilter']);
});

test('after the switch nothing is left to change (the runner checks this before it deploys)', () => {
  const cfg = hubYml();
  const switched = {
    rootDir: '',
    buildFilter: { paths: [...renderBuildFilter(cfg).paths].reverse(), ignoredPaths: renderBuildFilter(cfg).ignoredPaths },
    serviceDetails: { runtime: 'docker', envSpecificDetails: { dockerfilePath: './backend-hub/Dockerfile', dockerContext: '.', dockerCommand: '' } },
  };
  assert.equal(renderServicePatch(switched, cfg), null);
  // Render reporting the root as "." is the same root.
  assert.equal(renderServicePatch({ ...switched, rootDir: '.' }, cfg), null);
  // A Docker service whose Dockerfile moved gets only the Docker details.
  const moved = renderServicePatch({ ...switched, serviceDetails: { runtime: 'docker', envSpecificDetails: { dockerfilePath: './Dockerfile', dockerContext: 'backend-hub' } } }, cfg);
  assert.deepEqual(moved.patch, { serviceDetails: { envSpecificDetails: { dockerfilePath: './backend-hub/Dockerfile', dockerContext: '.' } } });
});

test('back to native, as the comment in target.yml says: runtime node with its commands, and the old root directory', () => {
  const cfg = { directory: 'backend-hub', build: 'npm run deps && npm ci && npm run build', render: { runtime: 'node', rootDir: 'backend-hub' } };
  const out = renderServicePatch({ rootDir: '', serviceDetails: { runtime: 'docker', envSpecificDetails: { dockerfilePath: './backend-hub/Dockerfile', dockerContext: '.' } } }, cfg);
  assert.deepEqual(out.patch, {
    serviceDetails: { runtime: 'node', envSpecificDetails: { buildCommand: 'npm run deps && npm ci && npm run build', startCommand: 'npm start' } },
    rootDir: 'backend-hub',
  });
});

test('backward compatible: a service that matches, or whose target.yml names no runtime, root or filter, gets no update', () => {
  // A Node service as before: its build and start commands on Render are left alone even when they differ.
  assert.equal(renderServicePatch(nativeHub, { directory: 'backend-hub', build: 'npm ci', render: { runtime: 'node' } }), null);
  // No runtime in target.yml: nothing is compared, whatever Render runs.
  assert.equal(renderServicePatch({ rootDir: 'x', serviceDetails: { runtime: 'python' } }, { directory: 'x', render: {} }), null);
  assert.equal(renderServicePatch({}, { directory: 'x' }), null);
  assert.equal(renderRootDir({ directory: 'x' }), 'x');
  assert.equal(renderBuildFilter({ directory: 'x' }), null);
  // A filter given with one list only sends both, as Render's schema requires.
  assert.deepEqual(renderBuildFilter({ render: { buildFilter: { paths: ['a/**'] } } }), { paths: ['a/**'], ignoredPaths: [] });
  // A runtime Render does not report yet: the change says so.
  assert.match(renderServicePatch({}, { render: { runtime: 'docker' } }).changes[0], /not reported/);
});
