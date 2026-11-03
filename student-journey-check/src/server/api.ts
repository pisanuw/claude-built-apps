import type { Transport } from '../core/http';
import { runStep, STEP_ORDER } from '../core/steps';
import type { JourneyConfig, JourneyState, StepId, StoredCookie } from '../core/types';
import { ConfigError, normalizeSiteUrl } from '../core/urls';

/**
 * The checker's only server endpoint. The browser calls it once per step and
 * carries the test student's session cookies between calls, so the server
 * stores nothing: no passwords, no results, no logs of who checked what.
 */
export interface ApiResponse {
  status: number;
  body: unknown;
}

const CONFIG_FIELDS: Array<keyof JourneyConfig> = [
  'siteUrl', 'username', 'password', 'coursePath', 'loginPath', 'dashboardPath', 'courseTitle',
  'lessonPath', 'quizPath', 'certificatePath', 'pricePath', 'expectedPrice',
];
const MAX_FIELD = 500;
const MAX_COOKIES = 40;
const MAX_COOKIE_BYTES = 8192;

class BadRequest extends Error {}

function str(v: unknown, field: string, max = MAX_FIELD): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new BadRequest(`${field} must be text.`);
  if (v.length > max) throw new BadRequest(`${field} is too long.`);
  return v;
}

export function parseConfig(raw: unknown): JourneyConfig {
  if (!raw || typeof raw !== 'object') throw new BadRequest('Missing site settings.');
  const o = raw as Record<string, unknown>;
  const out: Partial<JourneyConfig> = {};
  for (const f of CONFIG_FIELDS) {
    const v = str(o[f], f);
    if (v !== undefined) (out as Record<string, string>)[f] = v;
  }
  if (!out.siteUrl) throw new BadRequest('Enter your course site address.');
  out.siteUrl = normalizeSiteUrl(out.siteUrl);
  return { username: '', coursePath: '', ...out } as JourneyConfig;
}

export function parseState(raw: unknown): JourneyState {
  if (raw === undefined || raw === null) return { cookies: [], loggedIn: false };
  if (typeof raw !== 'object') throw new BadRequest('Bad session state.');
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.cookies) ? o.cookies : [];
  if (list.length > MAX_COOKIES) throw new BadRequest('Too many cookies.');
  const cookies: StoredCookie[] = [];
  let bytes = 0;
  for (const c of list) {
    const x = c as Record<string, unknown>;
    if (typeof x?.name !== 'string' || typeof x.value !== 'string') continue;
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(x.name) || /[\r\n;]/.test(x.value)) continue;
    const path = typeof x.path === 'string' && x.path.startsWith('/') ? x.path : '/';
    bytes += x.name.length + x.value.length;
    cookies.push({ name: x.name, value: x.value, path });
  }
  if (bytes > MAX_COOKIE_BYTES) throw new BadRequest('Session state is too large.');
  return {
    cookies,
    loggedIn: o.loggedIn === true,
    lessonUrl: str(o.lessonUrl, 'lessonUrl', 2000),
    enrolled: o.enrolled === true ? true : undefined,
  };
}

export async function handleApi(method: string, path: string, bodyText: string | null, transport: Transport): Promise<ApiResponse> {
  const route = path.replace(/^\/\.netlify\/functions\/api/, '/api').replace(/\/+$/, '');
  if (route === '/api/health') return { status: 200, body: { status: 'ok', service: 'student-journey-check' } };
  if (route !== '/api/step') return { status: 404, body: { error: 'Not found.' } };
  if (method !== 'POST') return { status: 405, body: { error: 'Use POST.' } };
  if (!bodyText || bodyText.length > 32_000) return { status: 400, body: { error: 'Missing or oversized request.' } };
  try {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new BadRequest('The request is not valid JSON.');
    }
    const step = data.step as StepId;
    if (!STEP_ORDER.includes(step)) throw new BadRequest('Unknown step.');
    if (data.consent !== true) throw new BadRequest('Confirm that you own the site or have permission to check it.');
    const config = parseConfig(data.config);
    const state = parseState(data.state);
    const out = await runStep(step, config, state, transport);
    return { status: 200, body: out };
  } catch (e) {
    if (e instanceof BadRequest || e instanceof ConfigError) return { status: 400, body: { error: e.message } };
    return { status: 500, body: { error: 'The checker failed unexpectedly.' } };
  }
}
