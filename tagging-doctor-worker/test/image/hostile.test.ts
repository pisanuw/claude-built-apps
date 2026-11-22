/**
 * AC-31 against the built image: each hostile fixture fails or finishes
 * without effect, inside the time limit, and the next job still runs.
 * The limit is 30 s here to keep the run short (the default is 120 s; a test
 * may only shorten it). Run: docker build -t tagging-doctor-worker:dev . && npm run test:image
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JAVA_NO_NETWORK } from '../../src/runner.ts';
import { makeZip } from '../zipmaker.ts';
import { ABS_MARK, docker, fixture, freshToken, LEFT_MARK, projectZip, QUEUED_MARK, startListener, TOKEN_A, TOKEN_B, Worker, type JobView } from './harness.ts';

const LIMIT = 30_000;
const execFileP = promisify(execFile);
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

  describe('R3a.1-2 and CR-10: no request leaves a job (biber, BibTeX, a .bcf the job writes)', () => {
    let listener: Awaited<ReturnType<typeof startListener>>;
    beforeAll(async () => {
      listener = await startListener();
    });
    afterAll(() => listener.close());
    const withUrl = (name: string) => fixture(name).replace('@URL@', listener.url);
    const runFiles = async (files: Record<string, string>) => {
      const token = freshToken();
      const j = await w.run(projectZip(files), 'main.tex', token);
      tokens.set(j.id, token);
      return j;
    };
    /** biblatex's own .bcf for biber-local.tex, with its data source replaced by `element`. */
    const bcf = (element: string, padding = '') =>
      fixture('biblatex-bcf.txt').replace('@DATASOURCE@', `${padding}${element}${padding}`);
    const ds = (value: string, tag = 'bcf:datasource', extra = '') => `<${tag} ${extra}type="file" datatype="bibtex" glob="false">${value}</${tag}>`;

    it('a remote biblatex resource is refused with the plain message, and nothing is fetched', async () => {
      const j = await runFiles({ 'main.tex': withUrl('biber-remote.tex') });
      expect(j.status).toBe('failed');
      expect(j.failure).toMatchObject({ kind: 'bibliography', message: 'Remote bibliographies are not fetched; add the .bib file to the zip.' });
      expect(listener.seen).toEqual([]);
      await withoutEffect(j);
    });

    it('a URL given to BibTeX is not fetched', async () => {
      const j = await runFiles({ 'main.tex': withUrl('bibtex-remote.tex') });
      expect(listener.seen).toEqual([]);
      await withoutEffect(j);
    });

    it('a .bcf the job writes itself, with the URL in five forms an XML reader accepts, before and within its last 1 MB, and over https and ftp: nothing is fetched', async () => {
      const u = listener.url;
      const host = u.replace('http://', '');
      const variants: Record<string, string> = {
        charref: bcf(ds(`http&#x3a;//${host}/v1-charref.bib`)),
        charref2: bcf(ds(`&#104;ttp://${host}/v1b-charref.bib`)),
        cdata: bcf(ds(`<![CDATA[${u}/v2-cdata.bib]]>`)),
        endtag: bcf(ds(`${u}/v3-endtag.bib`).replace('</bcf:datasource>', '</bcf:datasource >')),
        prefix: bcf(ds(`${u}/v4-prefix.bib`, 'x:datasource', 'xmlns:x="https://sourceforge.net/projects/biblatex" ')),
        middle: bcf(ds(`${u}/v5-middle.bib`), `<!-- ${'m'.repeat(1_200_000)} -->`),
        // R3a.3-1 (D-76): the check reads the last 1 MB; a source within it, after 1.2 MB, still gets the plain message.
        late: fixture('biblatex-bcf.txt').replace('@DATASOURCE@', `<!-- ${'m'.repeat(1_200_000)} -->${ds(`${u}/v6-late.bib`)}`),
        // R3a.F-1 (m3b): markup inside the value, and a quoted > among the attributes.
        comment: bcf(ds(`http:<!---->//${host}/c1-mid.bib`)),
        commentEnd: bcf(ds(`${u}/c2-end.bib<!-- x -->`)),
        pi: bcf(ds(`${u}/c3-pi.bib<?x y?>`)),
        quoted: bcf(ds(`${u}/c4-quoted.bib`, 'bcf:datasource', 'note="a>b" ')),
        https: bcf(ds(`https://${host}/v8-https.bib`)),
        ftp: bcf(ds(`ftp://${host}/v9-ftp.bib`)),
      };
      for (const [name, text] of Object.entries(variants)) {
        const j = await runFiles({ 'main.tex': fixture('writes-own-bcf.tex'), 'bcf.txt': text });
        // R3a.3-1 (D-76): "middle" sits beyond the last 1 MB the check reads, so biber tries and the proxy layer stops it.
        if (name === 'middle') expect(j.logTail.join('\n'), name).toContain("Can't connect to 127.0.0.1:9");
        else expect(j.logTail.join('\n'), name).toContain('HOSTILE-RESULT: wrote main.bcf');
        expect(j.status, name).toBe('failed');
        expect(j.failure?.kind, name).toBe('bibliography');
        expect(listener.seen, name).toEqual([]);
        await withoutEffect(j);
      }
    });

    it('biber run with the worker\'s environment fetches nothing even when the check is not asked (the proxy layer); without it, it does', async () => {
      const text = bcf(ds(`${listener.url}/direct.bib`) + ds(`https://${listener.url.replace('http://', '')}/direct-https.bib`));
      w.exec(['sh', '-c', 'rm -rf /srv/biber && install -d -o 10001 -g 10001 -m 0700 /srv/biber']);
      docker(['exec', '-i', w.name, 'sh', '-c', 'cat > /srv/biber/main.bcf && chown 10001:10001 /srv/biber/main.bcf'], text);
      // Asynchronous, so the listener in this process can accept biber's connection.
      const asTex = async (env: string) => {
        const cmd = `cd /srv/biber && timeout 60 setpriv --reuid=10001 --regid=10001 --clear-groups env -i PATH=/usr/local/texlive/2026/bin/x86_64-linux:/usr/bin:/bin HOME=/srv/biber TMPDIR=/srv/biber ${env} biber --noconf ./main.bcf 2>&1 || true`;
        return (await execFileP('docker', ['exec', w.name, 'sh', '-c', cmd])).stdout;
      };
      const proxies = ['http_proxy', 'https_proxy', 'ftp_proxy', 'all_proxy'].flatMap((k) => [`${k}=http://127.0.0.1:9`, `${k.toUpperCase()}=http://127.0.0.1:9`]).join(' ');
      const blocked = await asTex(proxies);
      expect(blocked).toMatch(/Can't connect to 127\.0\.0\.1:9/);
      expect(listener.seen).toEqual([]);
      await asTex('');
      expect(listener.seen.length).toBeGreaterThan(0); // the control: without the variables biber does reach the listener
      listener.seen.length = 0;
      w.exec(['rm', '-rf', '/srv/biber']);
    });

    it('R3a.3-2: veraPDF\'s Java with the worker\'s flags reaches nothing on loopback; without the two empty nonProxyHosts it does', async () => {
      const program = [
        'import java.net.*;',
        'public class Fetch { public static void main(String[] a) { for (String u : a) { try {',
        '  HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection(); c.setConnectTimeout(3000); c.setReadTimeout(3000);',
        '  System.out.println("FETCHED " + u + " " + c.getResponseCode());',
        '} catch (Exception e) { System.out.println("REFUSED " + u + " " + e); } } } }',
      ].join('\n');
      w.exec(['sh', '-c', 'rm -rf /srv/java && install -d -o 10001 -g 10001 -m 0700 /srv/java']);
      docker(['exec', '-i', w.name, 'sh', '-c', 'cat > /srv/java/Fetch.java && chown 10001:10001 /srv/java/Fetch.java'], program);
      const port = listener.url.split(':').at(-1);
      const asTex = async (flags: string[]) => {
        const cmd = `cd /srv/java && timeout 120 setpriv --reuid=10001 --regid=10001 --clear-groups env -i PATH=/usr/bin:/bin HOME=/srv/java java -Djava.io.tmpdir=/srv/java ${flags.join(' ')} Fetch.java http://127.0.0.1:${port}/java-loopback http://localhost:${port}/java-localhost 2>&1 || true`;
        return (await execFileP('docker', ['exec', w.name, 'sh', '-c', cmd])).stdout;
      };
      const blocked = await asTex(JAVA_NO_NETWORK);
      expect(blocked).toContain(`REFUSED http://127.0.0.1:${port}/java-loopback`);
      expect(blocked).toContain(`REFUSED http://localhost:${port}/java-localhost`);
      expect(listener.seen).toEqual([]);
      // The control: the flags of milestone 3a, without the two, let loopback through.
      const open = await asTex(JAVA_NO_NETWORK.filter((f) => !/NonProxyHosts|nonProxyHosts/.test(f)));
      expect(open).toContain(`FETCHED http://127.0.0.1:${port}/java-loopback 200`);
      expect(listener.seen.length).toBeGreaterThan(0);
      listener.seen.length = 0;
      w.exec(['rm', '-rf', '/srv/java']);
    });

    it('an ordinary biber bibliography and an ordinary BibTeX one still work', async () => {
      const biber = await runFiles({ 'main.tex': fixture('biber-local.tex'), 'refs.bib': fixture('refs.bib') });
      expect(biber.status).toBe('done');
      expect(biber.result).toMatchObject({ bibliography: 'biber' });
      expect(await w.pdfText(biber.id, tokens.get(biber.id))).toContain('Knuth');
      const bibtex = await runFiles({ 'main.tex': fixture('bibtex-local.tex'), 'refs.bib': fixture('refs.bib') });
      expect(bibtex.status).toBe('done');
      expect(bibtex.result).toMatchObject({ bibliography: 'bibtex' });
      expect(await w.pdfText(bibtex.id, tokens.get(bibtex.id))).toContain('Knuth');
      expect(listener.seen).toEqual([]);
    });
  });

  it('R3a.1-7: an uploaded main.pdf is not served when the document makes no page', async () => {
    const token = freshToken();
    const zip = makeZip([
      { name: 'main.tex', data: fixture('empty-with-pdf.tex') },
      { name: 'main.pdf', data: '%PDF-1.4 % UPLOADED-NOT-COMPILED' },
    ]);
    const j = await w.run(zip, 'main.tex', token);
    expect(j.status).toBe('failed');
    expect(j.failure?.kind).toBe('no-pdf');
    expect(j.pdf).toBe(false);
  });

  describe('R3a.3-1: a file the job writes cannot stop the server answering', () => {
    /** Runs the job while asking the health route every 200 ms; the slowest answer (ms) and how many came. */
    async function healthDuring(name: string): Promise<{ j: JobView; worst: number; answers: number; missed: number }> {
      let running = true;
      let worst = 0;
      let answers = 0;
      let missed = 0;
      const poll = (async () => {
        while (running) {
          const t0 = performance.now();
          try {
            const r = await fetch(`${w.base}/api/health`, { signal: AbortSignal.timeout(5_000) });
            await r.text();
            if (r.ok) answers++;
          } catch {
            missed++;
          }
          worst = Math.max(worst, performance.now() - t0);
          await new Promise((r) => setTimeout(r, 200));
        }
      })();
      // R3a.F-4: the poll stops whatever happens to the job.
      try {
        const j = await run(name);
        return { j, worst, answers, missed };
      } finally {
        running = false;
        await poll;
      }
    }

    it('(a) a 1 MB .bcf of unclosed <datasource tags: health answers throughout, biber fails on it', async () => {
      const { j, worst, answers, missed } = await healthDuring('bcf-flood.tex');
      console.log(`R3a.3-1 (a): ${seconds(j)} s, ${answers} health answers, slowest ${Math.round(worst)} ms, ${missed} missed`);
      expect(j.status).toBe('failed');
      expect(j.failure).toMatchObject({ kind: 'bibliography', message: 'biber stopped with an error.' });
      expect(missed).toBe(0);
      expect(answers).toBeGreaterThan(0);
      expect(worst).toBeLessThan(2_000);
      await withoutEffect(j);
    });

    it('(b) a log full of "Output written on " with no count: health answers throughout, the job ends done with no page count', async () => {
      const { j, worst, answers, missed } = await healthDuring('log-flood.tex');
      console.log(`R3a.3-1 (b): ${seconds(j)} s, ${answers} health answers, slowest ${Math.round(worst)} ms, ${missed} missed`);
      expect(results(j)).toContain('flooded the log');
      expect(j.status).toBe('done');
      expect(j.result?.pages).toBeNull();
      expect(missed).toBe(0);
      expect(answers).toBeGreaterThan(0);
      expect(worst).toBeLessThan(2_000);
      await withoutEffect(j);
    });
  });

  it('AC-64: the logs hold no marker, no token and no source text', () => {
    const logs = w.logs();
    expect(logs).toContain('"event":"job-finished"');
    for (const s of [ABS_MARK, QUEUED_MARK, LEFT_MARK, TOKEN_A, TOKEN_B, 'documentclass', 'HOSTILE-RESULT', 'luacode']) expect(logs, s).not.toContain(s);
  });
});
