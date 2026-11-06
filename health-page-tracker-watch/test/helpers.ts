/** Build a minimal HAR document for tests. */
export interface E {
  url: string;
  type?: string;
  pageref?: string;
  referer?: string;
  body?: string;
  mime?: string;
  t?: number;
}

export function makeHar(entries: E[], pages: Array<{ id: string; title: string }> = []): string {
  return JSON.stringify({
    log: {
      creator: { name: 'test', version: '1' },
      pages,
      entries: entries.map((e, i) => ({
        startedDateTime: new Date(Date.UTC(2026, 0, 1, 0, 0, e.t ?? i)).toISOString(),
        ...(e.type ? { _resourceType: e.type } : {}),
        ...(e.pageref ? { pageref: e.pageref } : {}),
        request: {
          method: e.body ? 'POST' : 'GET',
          url: e.url,
          headers: e.referer ? [{ name: 'Referer', value: e.referer }] : [],
          ...(e.body ? { postData: { mimeType: 'text/plain', text: e.body } } : {}),
        },
        response: { status: 200, headers: [], content: { mimeType: e.mime ?? 'text/plain' } },
      })),
    },
  });
}
