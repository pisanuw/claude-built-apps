import { InputError, normalizeSiteUrl, sameSite } from '../core/urls';
import { fetchFacts, fetchRobots, type Transport } from './http';

/**
 * The checker's only server endpoints. A web page cannot read another
 * website, so the browser asks the server for one store page at a time. The
 * server reads the page, keeps only the facts the checks compare (contact
 * details, shipping and return wording, prices), and stores nothing.
 */
export interface ApiResponse {
  status: number;
  body: unknown;
}

const MAX_BODY = 8_000;

function parseBody(bodyText: string | null): Record<string, unknown> {
  if (!bodyText || bodyText.length > MAX_BODY) throw new InputError('Missing or oversized request.');
  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new InputError('The request is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new InputError('The request is not valid JSON.');
  const o = data as Record<string, unknown>;
  if (o.consent !== true) throw new InputError('Confirm that the store is yours, or that you have the owner’s permission to check it.');
  if (typeof o.site !== 'string') throw new InputError('Enter your store’s web address.');
  return o;
}

export async function handleApi(method: string, path: string, bodyText: string | null, transport: Transport): Promise<ApiResponse> {
  const route = path.replace(/^\/\.netlify\/functions\/api/, '/api').replace(/\/+$/, '');
  if (route === '/api/health') return { status: 200, body: { status: 'ok', service: 'misrepresentation-preflight' } };
  if (route !== '/api/page' && route !== '/api/robots') return { status: 404, body: { error: 'Not found.' } };
  if (method !== 'POST') return { status: 405, body: { error: 'Use POST.' } };
  try {
    const data = parseBody(bodyText);
    const site = normalizeSiteUrl(data.site as string);
    if (route === '/api/robots') return { status: 200, body: { robots: await fetchRobots(site, transport) } };
    if (typeof data.url !== 'string' || data.url.length > 2000) throw new InputError('Missing page address.');
    let url: URL;
    try {
      url = new URL(data.url);
    } catch {
      throw new InputError('That page address is not valid.');
    }
    if (!sameSite(url.toString(), site)) throw new InputError('Only pages of the store you entered can be read.');
    return { status: 200, body: { page: await fetchFacts(site, url.toString(), transport) } };
  } catch (e) {
    if (e instanceof InputError) return { status: 400, body: { error: e.message } };
    return { status: 500, body: { error: 'The checker failed unexpectedly.' } };
  }
}
