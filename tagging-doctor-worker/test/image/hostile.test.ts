/**
 * AC-31 against the built image: each hostile fixture fails or finishes
 * without effect, inside the time limit, and the next job still runs.
 * The limit is 30 s here to keep the run short (the default is 120 s; a test
 * may only shorten it). Run: docker build -t tagging-doctor-worker:dev . && npm run test:image
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ABS_MARK, docker, fixture, freshToken, LEFT_MARK, projectZip, QUEUED_MARK, TOKEN_A, TOKEN_B, Worker, type JobView } from './harness.ts';

const LIMIT = 30_000;
let w: Worker;
beforeAll(async () => {
  w = await Worker.start({ jobLimitMs: LIMIT });
});
afterAll(async () => {
  await w?.stop();
});

const results = (j: JobView) => j.logTail.filter((l) => l.includes('HOSTILE-RESULT')).join('\n');
/** Each job as a user of its own, and the results read with that user's token. */
const tokens = new Map<string, string>();
async function run(name: string): Promise<JobView> {
  const token = freshToken();
  const j = await w.run(projectZip({ 'main.tex': fixture(name) }), 'main.tex', token);
  tokens.set(j.id, token);
  return j;
}
const seconds = (j: JobView) => (Date.parse(j.finishedAt as string) - Date.parse(j.startedAt as string)) / 1000;

/** "Without effect": no marker in the PDF's text or the log tail, and no file of the TeX user anywhere. */
async function withoutEffect(j: JobView, own: string[] = []) {
  const text = `${j.logTail.join('\n')}\n${await w.pdfText(j.id, tokens.get(j.id))}`;
  for (const mark of [ABS_MARK, QUEUED_MARK, LEFT_MARK]) if (!own.includes(mark)) expect(text, mark).not.toContain(mark);
  expect(w.texUserFiles()).toEqual([]);
  expect(seconds(j)).toBeLessThan(LIMIT / 1000 + 5);
}

describe('AC-31: hostile fixtures', () => {
  it('\\immediate\\write18: no command runs', async () => {
    const j = await run('write18.tex');
    expect(j.status).toBe('done');
    expect(results(j)).toContain('write18 blocked');
    // With shell escape off, LuaTeX writes the command into the log as text.
    expect(j.logTail).toContain('touch /dev/shm/td-write18');
    expect(w.exec(['sh', '-c', 'ls -A /dev/shm'])).not.toContain('td-write18');
    await withoutEffect(j);
  });

  it('\\input of the planted absolute-path file: not read', async () => {
    const j = await run('input-abs.tex');
    expect(j.status).toBe('failed');
    expect(j.failure?.kind).toBe('compile-error');
    await withoutEffect(j);
  });

  it('\\openout to ../x: refused', async () => {
    const j = await run('openout.tex');
    expect(j.status).toBe('failed');
    expect(j.logTail.join('\n')).toContain("I can't write on file `../escaped.tex'");
    await withoutEffect(j);
  });

  it('Lua os.execute, io.popen, os.spawn, package.loadlib and ffi: no command runs', async () => {
    const j = await run('lua-exec.tex');
    expect(j.status).toBe('done');
    const r = results(j);
    expect(r).toContain('lua command blocked');
    expect(r).toContain('lua spawn blocked');
    expect(r).not.toMatch(/uid=\d+/); // io.popen("id") gave nothing
    expect(r).toMatch(/ffi ok=(false|true r=nil)/);
    expect(w.exec(['sh', '-c', 'ls -A /dev/shm'])).not.toContain('td-');
    await withoutEffect(j);
  });

  it('Lua io.open of the planted file, with its text put into the PDF: not read', async () => {
    const j = await run('lua-read.tex');
    expect(j.status).toBe('done');
    expect(results(j)).toContain('io.open blocked');
    expect(results(j)).toContain('io.lines ok=false');
    await withoutEffect(j);
  });

  it("Lua require('socket'): no socket", async () => {
    const j = await run('lua-socket.tex');
    expect(results(j)).not.toContain('socket made');
    expect(results(j)).toContain('require socket.core ok=false');
    await withoutEffect(j);
  });

  it('lfs.dir of the jobs root: not listed', async () => {
    const j = await run('lua-lfsdir.tex');
    expect(j.status).toBe('done');
    const r = results(j);
    expect(r).toContain('lfs.dir /jobs blocked');
    expect(r).toContain('lfs.dir ../.. blocked');
    expect(`${j.logTail.join('\n')}${await w.pdfText(j.id, tokens.get(j.id))}`).not.toMatch(/[0-9a-f]{32}/);
    await withoutEffect(j);
  });

  it("a Lua read of a queued second job's file by its known path (two jobs)", async () => {
    w.clearHint();
    const a = (await (await w.submit(projectZip({ 'main.tex': fixture('lua-read-known.tex') }))).json()) as { id: string };
    expect((await w.waitFor(a.id, ['running', 'done', 'failed'])).status).toBe('running');
    const b = (await (await w.submit(projectZip({ 'main.tex': fixture('second-job.tex') }), 'main.tex', TOKEN_B)).json()) as { id: string };
    expect((await w.job(b.id, TOKEN_B)).status).toBe('queued');
    expect(w.exec(['stat', '-c', '%a %U', `/jobs/${b.id}.zip`]).trim()).toBe('600 root');
    w.hint([`/jobs/${b.id}.zip`, `/jobs/${b.id}/src/main.tex`, `/jobs/${b.id}`]);
    const ja = await w.waitFor(a.id, ['done', 'failed']);
    expect(ja.status).toBe('done');
    const r = results(ja);
    expect(r).not.toContain('no hint');
    expect(r.match(/blocked/g)?.length).toBe(3);
    const jb = await w.waitFor(b.id, ['done', 'failed'], TOKEN_B);
    expect(jb.status).toBe('done'); // the next job still runs
    await withoutEffect(ja);
    w.clearHint();
  });

  it("a file the previous job's processes left behind: removed, and not read by the next job", async () => {
    const p = await run('leave-behind.tex');
    expect(p.status).toBe('done');
    const r = results(p);
    expect(r).toContain('write /dev/shm ok=true r=false');
    expect(r).toContain('write /tmp ok=true r=false');
    expect(r).toContain('mkdir /tmp ok=true r=nil');
    // What it managed to leave in /dev/shm (a folder, a link) was removed after the job.
    expect(w.texUserFiles()).toEqual([]);
    expect(w.exec(['sh', '-c', 'ls -A /dev/shm /tmp /var/tmp'])).not.toContain('td-left');
    w.hint(['/dev/shm/td-left.txt', '/tmp/td-left.txt', '/dev/shm/td-left-link', '/dev/shm/td-left-moved.txt', '/dev/shm/td-left-dir', `/jobs/${p.id}/src/left.txt`, `/jobs/${p.id}.out/main.pdf`]);
    const n = await run('lua-read-known.tex');
    expect(n.status).toBe('done');
    expect(results(n).match(/blocked/g)?.length).toBe(7);
    await withoutEffect(n);
    w.clearHint();
  });

  it('an infinite loop is stopped at the limit, and the next job still runs', async () => {
    const j = await run('loop.tex');
    expect(j.status).toBe('failed');
    expect(j.failure?.kind).toBe('timeout');
    expect(seconds(j)).toBeGreaterThanOrEqual(LIMIT / 1000 - 1);
    await withoutEffect(j);
    expect((await run('write18.tex')).status).toBe('done');
  });

  it('a memory bomb fails without taking the server down, and the next job still runs', async () => {
    const j = await run('memory-bomb.tex');
    expect(j.status).toBe('failed');
    expect(j.logTail.join('\n')).toMatch(/not enough memory/);
    await withoutEffect(j);
    expect(docker(['inspect', '-f', '{{.State.OOMKilled}} {{.State.Running}} {{.RestartCount}}', w.name]).trim()).toBe('false true 0');
    expect((await run('write18.tex')).status).toBe('done');
  });

  it('AC-64: the logs hold no marker, no token and no source text', () => {
    const logs = w.logs();
    expect(logs).toContain('"event":"job-finished"');
    for (const s of [ABS_MARK, QUEUED_MARK, LEFT_MARK, TOKEN_A, TOKEN_B, 'documentclass', 'HOSTILE-RESULT', 'luacode']) expect(logs, s).not.toContain(s);
  });
});
