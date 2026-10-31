import type { Request, Response } from '../core/protocol';

type Pending = (r: Response) => boolean;
export type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

/** One long-lived worker per purpose; a new request cancels the old by restarting. */
export class EngineClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private handler: Pending | null = null;

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<Response>) => {
        if (this.handler && this.handler(ev.data)) this.handler = null;
      };
      this.worker.onerror = (ev) => {
        this.handler?.({ kind: 'error', id: -1, message: ev.message || 'worker failed' });
        this.handler = null;
        this.stop();
      };
    }
    return this.worker;
  }

  /** Abandon whatever is running. */
  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.handler = null;
  }

  /** Send a request; `on` gets each response for it and returns true when finished. */
  send(req: RequestBody, on: (r: Response) => boolean): void {
    if (this.handler) this.stop();
    const id = this.nextId++;
    this.handler = (r) => (r.id === id || r.id === -1 ? on(r) : false);
    this.ensure().postMessage({ ...req, id } as Request);
  }
}
