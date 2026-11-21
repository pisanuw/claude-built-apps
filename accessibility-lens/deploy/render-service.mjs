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
