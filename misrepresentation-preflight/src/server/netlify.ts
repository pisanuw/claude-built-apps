import { handleApi } from './api';
import type { Transport } from './http';
import { netTransport } from './transport';

/** The subset of a Netlify (Lambda-style) event the checker reads. */
export interface FnEvent {
  httpMethod: string;
  path: string;
  body: string | null;
  isBase64Encoded?: boolean;
}

/** Netlify stops a function after 10 seconds; one page (with its redirects) gets 8.5 seconds. */
export function makeHandler(newTransport: () => Transport = () => netTransport({ timeoutMs: 7000, budgetMs: 8500 })) {
  return async (event: FnEvent) => {
    const transport = newTransport();
    const body = event.body && event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const res = await handleApi(event.httpMethod, event.path, body, transport);
    return {
      statusCode: res.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      body: JSON.stringify(res.body),
    };
  };
}

export const handler = makeHandler();
