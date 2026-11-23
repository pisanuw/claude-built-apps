/**
 * R3a.1-1 and R3a.1-3 against the built image: parallel 25 MB uploads at
 * 0.1 CPU and 512 MB leave the worker up, and a worker whose TeX cannot run
 * as a user of its own takes no job.
 */
import { request } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { docker, freshToken, PREFIX, projectZip, Worker } from './harness.ts';

let w: Worker | null = null;
afterEach(async () => {
  await w?.stop();
  w = null;
});

/** One POST of `bytes` bytes; the status, or -1 when the connection was closed first. */
function upload(base: string, token: string, bytes: Buffer): Promise<number> {
  return new Promise((resolve) => {
    const req = request(`${base}/api/jobs?mainFile=main.tex`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(-1));
    req.end(bytes);
  });
}

describe('R3a.1-1: uploads in flight on the image', () => {
  it('40 parallel 25 MB uploads at 0.1 CPU and 512 MB: the worker stays up, and the rest are told it is busy', async () => {
    w = await Worker.start({ cpus: '0.1' });
    const body = Buffer.alloc(25 * 1024 * 1024 - 1024, 7); // not a zip: each taken body ends in 400
    const statuses = await Promise.all(Array.from({ length: 40 }, () => upload((w as Worker).base, freshToken(), body)));
    const count = (s: number) => statuses.filter((x) => x === s).length;
    console.log(`R3a.1-1 statuses: 400=${count(400)} 429=${count(429)} closed=${count(-1)} other=${statuses.length - count(400) - count(429) - count(-1)}`);
    expect(statuses.every((s) => s === 400 || s === 429 || s === -1)).toBe(true);
    expect(count(400)).toBeGreaterThan(0);
    expect(count(429)).toBeGreaterThan(0);
    expect(docker(['inspect', '-f', '{{.State.OOMKilled}} {{.State.Running}} {{.RestartCount}}', w.name]).trim()).toBe('false true 0');
    expect((await fetch(`${w.base}/api/health`)).status).toBe(200);
    expect(w.exec(['sh', '-c', 'ls -A /jobs | grep -c part || true']).trim()).toBe('0');
  });
});

describe('R3a.2-1: clients that leave during the token check', () => {
  it('hold no slot: after four leave, an ordinary upload is accepted', async () => {
    w = await Worker.start({ authDelayMs: 800 });
    const port = Number(new URL(w.base).port);
    const leave = (token: string) =>
      new Promise<void>((done) => {
        const sock = connect(port, '127.0.0.1', () => {
          sock.write(`POST ${PREFIX}/api/jobs?mainFile=main.tex HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\nContent-Length: 1048576\r\n\r\n`);
          sock.write(Buffer.alloc(1024));
          setTimeout(() => {
            sock.destroy();
            done();
          }, 200);
        });
        sock.on('error', () => done());
      });
    await Promise.all([1, 2, 3, 4].map(() => leave(freshToken())));
    await new Promise((r) => setTimeout(r, 2000));
    const h = (await (await fetch(`${w.base}/api/health`)).json()) as { queue: Record<string, number> };
    expect(h.queue).toMatchObject({ running: 0, waiting: 0, uploading: 0 });
    expect(w.exec(['sh', '-c', 'ls -A /jobs | grep -c part || true']).trim()).toBe('0');
    const ok = await w.run(projectZip({ 'main.tex': '\\documentclass{article}\\begin{document}Hi.\\end{document}' }), 'main.tex', freshToken());
    expect(ok.status).toBe('done');
  });
});

describe('R3a.1-3: no TeX user of its own', () => {
  it('the health route says compile is off, and a job gets 503', async () => {
    w = await Worker.start({ extraEnv: { TEX_UID: 'none' } });
    const h = (await (await fetch(`${w.base}/api/health`)).json()) as Record<string, unknown>;
    expect(h).toMatchObject({ status: 'ok', compile: false, selfTest: { separateUser: false }, queue: { maxWaiting: 0 } });
    const r = await w.submit(new Uint8Array(100), 'main.tex', freshToken());
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('The checker is not available. The scan still works.');
  });
});
