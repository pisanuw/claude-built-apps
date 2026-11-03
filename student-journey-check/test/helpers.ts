import type { RawRequest, RawResponse, Transport } from '../src/core/http';
import { runStep } from '../src/core/steps';
import type { JourneyConfig, JourneyState, StepId } from '../src/core/types';

export type Route = RawResponse | ((req: RawRequest) => RawResponse | Promise<RawResponse>);

export const SITE = 'https://academy.test-site.com';

export function wp(body: string, head = ''): string {
  return `<html><head><title>Academy</title>${head}<link rel="stylesheet" href="/wp-content/plugins/tutor/x.css"></head><body>${body}</body></html>`;
}

export function ok(text: string, setCookies: string[] = []): RawResponse {
  return { status: 200, headers: { 'content-type': 'text/html' }, setCookies, text };
}

export function status(code: number, text = ''): RawResponse {
  return { status: code, headers: {}, setCookies: [], text };
}

export function to(location: string, setCookies: string[] = []): RawResponse {
  return { status: 302, headers: { location }, setCookies, text: '' };
}

/** A fake site: "GET /path" or "/path" (any method) keys. Unknown paths are 404s. */
export function site(routes: Record<string, Route>): Transport & { log: RawRequest[] } {
  const log: RawRequest[] = [];
  const t = (async (req: RawRequest) => {
    log.push(req);
    const u = new URL(req.url);
    const r = routes[`${req.method} ${u.pathname}${u.search}`] ?? routes[`${req.method} ${u.pathname}`] ?? routes[u.pathname];
    if (!r) return status(404, wp('<h1>Not here</h1>'));
    return typeof r === 'function' ? r(req) : r;
  }) as Transport & { log: RawRequest[] };
  t.log = log;
  return t;
}

export const BASE: JourneyConfig = {
  siteUrl: SITE,
  username: 'test.student',
  password: 'pw',
  coursePath: '/courses/c/',
};

export const LOGGED_IN: JourneyState = { cookies: [{ name: 'wordpress_logged_in_x', value: '1', path: '/' }], loggedIn: true };

export async function step(id: StepId, t: Transport, config: Partial<JourneyConfig> = {}, state: JourneyState = LOGGED_IN) {
  const out = await runStep(id, { ...BASE, ...config }, state, t);
  return out;
}

export const LOGIN_FORM = `<form id="loginform" action="${SITE}/wp-login.php" method="post"><input type="text" name="log"><input type="password" name="pwd"><input type="checkbox" name="rememberme" value="forever"><input type="hidden" name="redirect_to" value="${SITE}/dashboard/"><input type="submit" name="wp-submit" value="Log In"></form>`;
