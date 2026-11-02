/** Build a minimal HAR document for tests. */
export interface E {
  url: string;
  type?: string;
  cookie?: string;
  setCookie?: string[];
  harCookies?: Array<{ name: string; value: string; domain?: string }>;
  by?: string[];
  parent?: string[];
  initUrl?: string;
  body?: string;
  mime?: string;
  t?: number;
}

export function makeHar(entries: E[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    log: {
      creator: { name: 'test', version: '1' },
      pages: [{ title: 'Test shop' }],
      ...extra,
      entries: entries.map((e, i) => ({
        startedDateTime: new Date(Date.UTC(2026, 0, 1, 0, 0, e.t ?? i)).toISOString(),
        _resourceType: e.type,
        _initiator: e.by || e.initUrl
          ? { type: 'script', url: e.initUrl, stack: e.by ? { callFrames: e.by.map((url) => ({ url })), parent: e.parent ? { callFrames: e.parent.map((url) => ({ url })) } : undefined } : undefined }
          : undefined,
        request: { method: 'GET', url: e.url, headers: e.cookie ? [{ name: 'Cookie', value: e.cookie }] : [], cookies: e.harCookies ?? [] },
        response: {
          status: 200,
          headers: (e.setCookie ?? []).map((v) => ({ name: 'Set-Cookie', value: v })),
          cookies: [],
          content: { mimeType: e.mime ?? (e.type === 'document' ? 'text/html' : 'application/javascript'), ...(e.body ? { text: e.body } : {}) },
        },
      })),
    },
  });
}
