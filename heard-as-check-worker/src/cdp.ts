/**
 * The Chrome DevTools Protocol over Chromium's `--remote-debugging-pipe`
 * (fd 3 to Chromium, fd 4 from it): each message is JSON ended by a NUL. The
 * bytes are split on the NUL before decoding, so a character split across
 * two chunks is never decoded in half (D-27). A message longer than
 * `maxMessage` ends the connection: no single answer may pass the job's
 * output cap (AC-12).
 */
import type { Readable, Writable } from 'node:stream';

export class CdpError extends Error {
  override name = 'CdpError';
}

type Waiter = { resolve: (v: unknown) => void; reject: (e: Error) => void };
export type CdpEvent = { method: string; params?: Record<string, unknown>; sessionId?: string };

export class Cdp {
  private id = 0;
  private readonly waiting = new Map<number, Waiter>();
  private readonly handlers = new Set<(e: CdpEvent) => void>();
  private closed: Error | null = null;
  /** The largest message seen, in bytes. */
  largest = 0;
  private readonly out: Writable;

  constructor(out: Writable, input: Readable, maxMessage: number) {
    this.out = out;
    let buf: Buffer = Buffer.alloc(0);
    out.on('error', () => this.close(new CdpError('pipe to chromium closed')));
    input.on('error', () => this.close(new CdpError('pipe from chromium closed')));
    input.on('end', () => this.close(new CdpError('chromium closed the pipe')));
    input.on('data', (chunk: Buffer) => {
      // Once closed (a message over the cap, or unreadable), nothing more is kept (R2.1-6).
      if (this.closed) {
        buf = Buffer.alloc(0);
        return;
      }
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let i: number;
      while ((i = buf.indexOf(0)) >= 0) {
        this.largest = Math.max(this.largest, i);
        let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
        try {
          msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
        } catch {
          this.close(new CdpError('unreadable message from chromium'));
          return;
        }
        buf = buf.subarray(i + 1);
        if (typeof msg.id === 'number' && this.waiting.has(msg.id)) {
          const w = this.waiting.get(msg.id) as Waiter;
          this.waiting.delete(msg.id);
          if (msg.error) w.reject(new CdpError(String(msg.error.message ?? 'error').slice(0, 300)));
          else w.resolve(msg.result);
        } else if (typeof msg.method === 'string') {
          for (const h of this.handlers) h({ method: msg.method, params: msg.params, sessionId: msg.sessionId });
        }
      }
      if (buf.length > maxMessage) {
        this.largest = Math.max(this.largest, buf.length);
        buf = Buffer.alloc(0);
        this.close(new CdpError('message over the cap'));
      }
    });
  }

  on(handler: (e: CdpEvent) => void): void {
    this.handlers.add(handler);
  }

  close(err: Error): void {
    if (this.closed) return;
    this.closed = err;
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }

  get error(): Error | null {
    return this.closed;
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.out.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }
}
