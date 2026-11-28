/** The driver's parts that need no Chromium: the loopback server, Chromium's flags, the sandbox facts (AC-14, AC-15). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chromeArgs, chromeArgv, hasHeading, REAPER, resolveStatic, sandboxFacts, staticServer, stopChrome } from '../src/driver.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'hac-drv-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the loopback server', () => {
  it('serves only the page, the listed pdf.js files and the job\'s file, under a secret path', () => {
    expect(resolveStatic('capture.html', '/s', '/p')).toBe('/s/capture.html');
    expect(resolveStatic('capture.mjs', '/s', '/p')).toBe('/s/capture.mjs');
    expect(resolveStatic('pdfjs/build/pdf.mjs', '/s', '/p')).toBe('/p/build/pdf.mjs');
    expect(resolveStatic('pdfjs/cmaps/UniJIS-UCS2-H.bcmap', '/s', '/p')).toBe('/p/cmaps/UniJIS-UCS2-H.bcmap');
    for (const bad of ['pdfjs/build/pdf.sandbox.mjs', 'pdfjs/cmaps/', 'pdfjs/../package.json', 'pdfjs/cmaps/../../x', '../etc/passwd', 'selftest.pdf', 'pdfjs//build/pdf.mjs', 'a b', 'pdfjs/./build/pdf.mjs']) {
      expect(resolveStatic(bad, '/s', '/p'), bad).toBeNull();
    }
  });

  it('answers 404 outside the secret path, for other methods and for missing files', async () => {
    const s = tmp();
    const p = tmp();
    writeFileSync(path.join(s, 'capture.html'), '<!doctype html>');
    mkdirSync(path.join(p, 'build'));
    writeFileSync(path.join(p, 'build', 'pdf.mjs'), 'export {}');
    mkdirSync(path.join(p, 'wasm'));
    writeFileSync(path.join(p, 'wasm', 'openjpeg.wasm'), 'w');
    const file = path.join(s, 'in.pdf');
    writeFileSync(file, '%PDF-1.7');
    const srv = await staticServer(file, s, p);
    try {
      expect(srv.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
      const page = await fetch(`${srv.base}capture.html`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect((await fetch(`${srv.base}job.pdf`)).headers.get('content-type')).toBe('application/pdf');
      expect(await (await fetch(`${srv.base}pdfjs/build/pdf.mjs`)).text()).toBe('export {}');
      expect((await fetch(`${srv.base}pdfjs/wasm/openjpeg.wasm`)).headers.get('content-type')).toBe('application/wasm');
      expect((await fetch(`${srv.base}capture.mjs`)).status).toBe(404);
      expect((await fetch(`${srv.base}pdfjs/build`)).status).toBe(404);
      const origin = srv.base.replace(/[0-9a-f]{32}\/$/, '');
      expect((await fetch(`${origin}capture.html`)).status).toBe(404);
      expect((await fetch(`${origin}${'0'.repeat(32)}/capture.html`)).status).toBe(404);
      expect((await fetch(`${srv.base}capture.html`, { method: 'POST' })).status).toBe(404);
    } finally {
      srv.close();
    }
  });
});

describe('Chromium\'s flags (AC-14, AC-15)', () => {
  it('keep the sandbox on and send everything but loopback nowhere', () => {
    const a = chromeArgs('/j/profile');
    expect(a).not.toContain('--no-sandbox');
    expect(a.some((f) => /no-zygote|single-process|disable-setuid-sandbox|disable-seccomp/.test(f))).toBe(false);
    expect(a).toContain('--remote-debugging-pipe');
    expect(a).toContain('--user-data-dir=/j/profile');
    expect(a).toContain('--proxy-server=http://127.0.0.1:9');
    expect(a).toContain('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
    expect(a.at(-1)).toBe('about:blank');
  });
});

describe('the reaper (D-44)', () => {
  it('starts Chromium as the job user below a Perl subreaper that waits for every process', () => {
    const argv = chromeArgv({ chrome: '/opt/chrome/chrome-headless-shell', jobDir: '/j', uid: 10002, gid: 10002 });
    expect(argv.slice(0, 2)).toEqual(['perl', '-e']);
    expect(argv[2]).toBe(REAPER);
    expect(REAPER).toContain('syscall(157, 36, 1)');
    expect(REAPER).toContain('waitpid(-1, 0)');
    expect(argv.slice(3, 6)).toEqual(['setpriv', '--reuid=10002', '--regid=10002']);
    expect(argv).not.toContain('--no-new-privs');
    expect(argv).toContain('/opt/chrome/chrome-headless-shell');
  });

  it.runIf(process.platform === 'linux' && process.arch === 'x64')('reaps an orphaned grandchild and ends when the last one ends', () => {
    // The child starts a grandchild that outlives it; the reaper still returns only after both have ended, and leaves no zombie.
    const r = spawnSync('perl', ['-e', REAPER, 'sh', '-c', '(sleep 0.2; echo grandchild) & echo child'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual(['child', 'grandchild']);
  });
});

describe('ending Chromium (D-44)', () => {
  it('kills the job user\'s processes and leaves the reaper to end; kills the reaper only when it does not', async () => {
    const calls: string[] = [];
    let end: () => void = () => undefined;
    const exited = new Promise<void>((r) => (end = r));
    await stopChrome({ proc: { kill: () => (calls.push('reaper'), true) }, exited }, 10002, (uid) => (calls.push(`uid ${uid}`), end(), 4));
    expect(calls).toEqual(['uid 10002']);
    calls.length = 0;
    await stopChrome({ proc: { kill: () => (calls.push('reaper'), true) }, exited: new Promise(() => undefined) }, 10002, (uid) => (calls.push(`uid ${uid}`), 0), 1);
    expect(calls).toEqual(['uid 10002', 'uid 10002', 'uid 10002', 'reaper']);
  });
});

describe('the sandbox facts', () => {
  it('count the job user\'s Chromium processes and those under a seccomp filter', () => {
    const root = tmp();
    const add = (pid: number, name: string, uid: number, seccomp: number, nspid: string) => {
      mkdirSync(path.join(root, String(pid)));
      writeFileSync(path.join(root, String(pid), 'status'), `Name:\t${name}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nSeccomp:\t${seccomp}\nNSpid:\t${nspid}\n`);
    };
    add(1, 'chrome-headless', 10002, 2, '1');
    add(2, 'chrome-headless', 10002, 0, '2\t1');
    add(3, 'chrome-headless', 10001, 2, '3\t1');
    add(4, 'java', 10002, 0, '4');
    mkdirSync(path.join(root, '5'));
    mkdirSync(path.join(root, 'self'));
    expect(sandboxFacts(10002, root)).toEqual({ processes: 2, seccomp: 1, namespaced: 1 });
  });

  it('finds the self-test\'s heading as a heading\'s name or as text beside a heading (D-39)', () => {
    const r = (o: object) => JSON.stringify(o);
    expect(hasHeading([r({ r: 'heading', n: 'Heard-As self-test' })], 'Heard-As self-test')).toBe(true);
    expect(hasHeading([r({ r: 'heading' }), r({ r: 'StaticText', n: 'Heard-As self-test' })], 'Heard-As self-test')).toBe(true);
    expect(hasHeading([r({ r: 'paragraph' }), r({ r: 'StaticText', n: 'Heard-As self-test' })], 'Heard-As self-test')).toBe(false);
    expect(hasHeading([r({ r: 'heading' }), r({ r: 'StaticText', n: 'Other' })], 'Heard-As self-test')).toBe(false);
  });
});
