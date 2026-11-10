/** Small helpers shared by the sign-in modules. */

/** An error's message, cut to 300 characters, for logs and detail columns. */
export const errorText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

/** A count from SQL (PostgREST may send numbers as strings); anything else is 0. */
export const num = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};

/**
 * The request body as text, or null when it is larger than `max` bytes. A
 * too-large Content-Length is refused before reading, and the stream is
 * cancelled as soon as it passes the limit, so a public function never holds
 * a huge body in memory.
 */
export async function readBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
