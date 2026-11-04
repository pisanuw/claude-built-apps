import type { Fetcher } from '../core/scan';
import type { PageError, PageFacts } from '../core/types';
import { InputError } from '../core/urls';

/**
 * Reads a real store through the checker's server, one page per call. The
 * server sends back only the facts it read, never the page.
 */
export function remoteFetcher(fetchImpl: typeof fetch, site: string, endpoint = '/api'): Fetcher {
  const call = async (route: string, body: Record<string, unknown>): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetchImpl(`${endpoint}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site, consent: true, ...body }),
      });
    } catch {
      throw new Error('The checker service could not be reached. Check your internet connection and try again.');
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const error = (data as { error?: unknown } | null)?.error;
    if (res.status === 400) throw new InputError(typeof error === 'string' ? error : 'The checker could not use that address.');
    if (!res.ok || !data) throw new Error(`The checker service had a problem (HTTP ${res.status}). Try again in a minute.`);
    return data;
  };
  return {
    async robots() {
      const data = (await call('robots', {})) as { robots?: unknown };
      return typeof data.robots === 'string' ? data.robots : null;
    },
    async page(url: string) {
      const data = (await call('page', { url })) as { page?: PageFacts | PageError };
      if (!data.page || typeof data.page !== 'object') return { url, error: 'The checker service sent an empty answer.' };
      return data.page;
    },
  };
}
