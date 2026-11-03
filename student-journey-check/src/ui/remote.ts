import type { StepOutcome, StepRunner } from '../core/types';

/** A problem with what the owner typed: shown next to the form, and the run stops. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/**
 * Runs each step on the checker's server (a real site cannot be read from the
 * browser: other sites do not let a web page load them). The session cookies
 * travel back and forth with each call; the server keeps nothing.
 */
export function remoteRunner(fetchImpl: typeof fetch, endpoint = '/api/step'): StepRunner {
  return async (step, config, state) => {
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step, config, state, consent: true }),
      });
    } catch {
      return failed(step, state, 'The checker service could not be reached. Check your internet connection and try again.');
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const error = (data as { error?: unknown } | null)?.error;
    if (res.status === 400) throw new InputError(typeof error === 'string' ? error : 'The checker could not read those settings.');
    const out = data as StepOutcome | null;
    if (!res.ok || !out?.result || !out.state) {
      return failed(step, state, `The checker service had a problem (HTTP ${res.status}). Try again in a minute.`);
    }
    return out;
  };
}

function failed(step: Parameters<StepRunner>[0], state: Parameters<StepRunner>[2], headline: string): StepOutcome {
  return { result: { id: step, status: 'fail', headline, ms: 0 }, state };
}
