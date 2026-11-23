/**
 * The runtime part of a new Render web service, from target.yml (pure, so it
 * can be tested without the Render API).
 *
 * A Node service (the default, `render.runtime: node`) gets the build and
 * start commands, as before. A Docker service (`render.runtime: docker`) is
 * built from its Dockerfile and started by the image's CMD, so it gets
 * `dockerfilePath` and `dockerContext` instead (tagging-doctor-worker, Tagging
 * Doctor spec question 1). Both paths are relative to the service's root
 * directory (`directory` in target.yml); Render's defaults are `./Dockerfile`
 * and `.`.
 */
export function renderRuntime(cfg) {
  const r = cfg.render ?? {};
  const env = r.runtime ?? 'node';
  if (env === 'docker') {
    return {
      env,
      envSpecificDetails: {
        dockerfilePath: r.dockerfilePath ?? './Dockerfile',
        dockerContext: r.dockerContext ?? '.',
      },
    };
  }
  return {
    env,
    envSpecificDetails: {
      buildCommand: cfg.build,
      startCommand: r.startCommand ?? 'npm start',
    },
  };
}

/**
 * The service's root directory: `render.rootDir` when target.yml sets it,
 * else `directory` (as before). backend-hub's Docker image needs three of the
 * repository's folders in its build context, and Render gives a build only
 * the files under the root directory, so its target.yml sets `rootDir: ''`
 * (the repository's root) with a build filter (CR-13, Tagging Doctor D-122).
 */
export function renderRootDir(cfg) {
  const r = cfg.render ?? {};
  return typeof r.rootDir === 'string' ? r.rootDir.replace(/^\.\/?$/, '') : cfg.directory;
}

/** `render.buildFilter` ({ paths, ignoredPaths }, both relative to the repository's root), or null when unset. */
export function renderBuildFilter(cfg) {
  const f = cfg.render?.buildFilter;
  if (!f || typeof f !== 'object') return null;
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  return { paths: list(f.paths), ignoredPaths: list(f.ignoredPaths) };
}

const sameList = (a = [], b = []) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * What an existing service must change to match target.yml, as the body of
 * Render's Update service (PATCH /services/{id}), or null when nothing
 * differs. Before this, the runner changed only the plan and the env vars of
 * a service that exists (D-108), so a native service could not become a
 * Docker one. Only what target.yml states is compared:
 * - the runtime, when `render.runtime` is set and differs from the service's
 *   (native to Docker, or back), with the runtime's details; for a Docker
 *   service that stays Docker, its `dockerfilePath` and `dockerContext`;
 * - the root directory, when `render.rootDir` is set;
 * - the build filter, when `render.buildFilter` is set.
 * A Node service whose target.yml names its runtime and matches it gets no
 * change: its build and start commands are left as they are on Render.
 * `found` is the service object of GET /services or GET /services/{id}.
 */
export function renderServicePatch(found, cfg) {
  const r = cfg.render ?? {};
  const details = found?.serviceDetails ?? {};
  const patch = {};
  const changes = [];
  if (typeof r.runtime === 'string') {
    const want = renderRuntime(cfg);
    const have = details.runtime ?? details.env;
    if (have !== want.env) {
      patch.serviceDetails = { runtime: want.env, envSpecificDetails: want.envSpecificDetails };
      changes.push(`runtime ${have ?? '(not reported)'} -> ${want.env}`);
    } else if (want.env === 'docker') {
      const cur = details.envSpecificDetails ?? {};
      const w = want.envSpecificDetails;
      if (cur.dockerfilePath !== w.dockerfilePath || cur.dockerContext !== w.dockerContext) {
        patch.serviceDetails = { envSpecificDetails: w };
        changes.push(`docker ${cur.dockerfilePath ?? '?'} in ${cur.dockerContext ?? '?'} -> ${w.dockerfilePath} in ${w.dockerContext}`);
      }
    }
  }
  if (typeof r.rootDir === 'string') {
    const want = renderRootDir(cfg);
    const have = (found?.rootDir ?? '').replace(/^\.\/?$/, '');
    if (have !== want) {
      patch.rootDir = want;
      changes.push(`rootDir "${have}" -> "${want}"`);
    }
  }
  const filter = renderBuildFilter(cfg);
  if (filter) {
    const have = found?.buildFilter ?? {};
    if (!sameList(have.paths ?? [], filter.paths) || !sameList(have.ignoredPaths ?? [], filter.ignoredPaths)) {
      patch.buildFilter = filter;
      changes.push(`buildFilter -> ${filter.paths.length} paths, ${filter.ignoredPaths.length} ignored`);
    }
  }
  return changes.length ? { patch, changes } : null;
}
