/**
 * Wait for a Render deploy to reach a final status.
 *
 * Triggering a deploy (POST /services/{id}/deploys) returns at once, while the
 * old instance keeps serving traffic until the new one is live. A health check
 * run straight after the trigger therefore passes against the old instance,
 * and a failed build is reported healthy. deploy.mjs calls waitForRenderDeploy
 * first and runs the health check only once the deploy is `live`.
 *
 * No side effects on import; fetch and sleep are injected so tests run
 * without the network or real timers.
 */

/** Statuses that mean the deploy will never go live. */
export const RENDER_DEPLOY_FAILED = new Set([
  'build_failed',
  'update_failed',
  'canceled',
  'deactivated',
  'pre_deploy_failed',
]);

export const RENDER_DEPLOY_LIVE = 'live';

/**
 * Poll a deploy until it is live, has failed, or the time runs out.
 *
 * @param {object} opts
 * @param {() => Promise<string|undefined>} opts.fetchStatus  returns the deploy's current status
 * @param {(ms: number) => Promise<void>} [opts.sleep]         waits between polls
 * @param {(msg: string) => void} [opts.log]                    called once per status change
 * @param {number} [opts.intervalMs=15000]
 * @param {number} [opts.timeoutMs=1200000]                    about 20 minutes
 * @param {string} [opts.label='Render deploy']
 * @returns {Promise<{ ok: true, status: string } | { ok: false, status?: string, reason: 'failed'|'timeout', message: string }>}
 */
export async function waitForRenderDeploy({
  fetchStatus,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
  intervalMs = 15_000,
  timeoutMs = 20 * 60_000,
  label = 'Render deploy',
}) {
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1);
  let last;
  let seen = false;
  for (let poll = 1; poll <= maxPolls; poll++) {
    let status;
    try {
      status = await fetchStatus();
    } catch (e) {
      // A transient API error should not fail the deploy; keep the last status
      // and try again until the timeout.
      log(`${label}: status check failed (${String(e?.message || e).slice(0, 200)}); retrying`);
      status = last;
    }
    if (!seen || status !== last) {
      log(`${label}: status ${status ?? '(not reported)'}`);
      last = status;
      seen = true;
    }
    if (status === RENDER_DEPLOY_LIVE) return { ok: true, status };
    if (RENDER_DEPLOY_FAILED.has(status)) {
      return { ok: false, status, reason: 'failed', message: `${label} ended with status ${status}.` };
    }
    if (poll < maxPolls) await sleep(intervalMs);
  }
  const minutes = Math.round(timeoutMs / 60_000);
  return {
    ok: false,
    status: last,
    reason: 'timeout',
    message: `${label} not live after ~${minutes} min (last status: ${last ?? '(not reported)'}).`,
  };
}
