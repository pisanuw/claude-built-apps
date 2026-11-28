/** The driver's parts that need no Chromium: the loopback server, Chromium's flags, the sandbox facts (AC-14, AC-15). */
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chromeArgs, chromeArgv, hasHeading, readJobFile, REAPER, resolveStatic, sandboxFacts, staticServer, stopChrome } from '../src/driver.ts';

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
    const srv = await staticServer(readJobFile(file, process.getuid?.() ?? 0), s, p);
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

  it('serves the job\'s file from the bytes read once: a link swapped in for in.pdf afterwards is never followed (R2.1-3)', async () => {
    const dir = tmp();
    const file = path.join(dir, 'in.pdf');
    const pdf = Buffer.from('%PDF-1.7\n' + 'x'.repeat(5000));
    writeFileSync(file, pdf);
    const secret = path.join(tmp(), 'secret');
    writeFileSync(secret, 'ROOT-ONLY-SECRET\n', { mode: 0o600 });
    const srv = await staticServer(readJobFile(file, process.getuid?.() ?? 0), dir, dir);
    try {
      expect(Buffer.from(await (await fetch(`${srv.base}job.pdf`)).arrayBuffer()).equals(pdf)).toBe(true);
      rmSync(file);
      symlinkSync(secret, file);
      const again = Buffer.from(await (await fetch(`${srv.base}job.pdf`)).arrayBuffer());
      expect(again.equals(pdf)).toBe(true);
      expect(again.toString()).not.toContain('ROOT-ONLY');
    } finally {
      srv.close();
    }
  });

  it('reads the job\'s file only as a regular file of the job user with one link and at most 10 MB, never through a link (R2.1-3)', () => {
    const me = process.getuid?.() ?? 0;
    const dir = tmp();
    const file = path.join(dir, 'in.pdf');
    writeFileSync(file, '%PDF-1.7 ok');
    expect(readJobFile(file, me).toString()).toBe('%PDF-1.7 ok');
    // Someone else's file, a file over the size, a link, a second hard link, a FIFO and a folder are refused.
    expect(() => readJobFile(file, me + 1)).toThrow(/refused/);
    expect(() => readJobFile(file, me, 5)).toThrow(/refused/);
    const link = path.join(dir, 'link.pdf');
    symlinkSync(file, link);
    expect(() => readJobFile(link, me)).toThrow(/ELOOP/);
    const hard = path.join(dir, 'hard.pdf');
    linkSync(file, hard);
    expect(() => readJobFile(file, me)).toThrow(/refused/);
    rmSync(hard);
    expect(readJobFile(file, me).length).toBe(11);
    const fifo = path.join(dir, 'fifo.pdf');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    expect(() => readJobFile(fifo, me)).toThrow(/refused/);
    expect(() => readJobFile(dir, me)).toThrow(/refused/);
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
    // prctl's number by machine, and a failed call ends the reaper rather than run without one (R2.1-8).
    expect(REAPER).toContain('? 167 : $Config{archname} =~ /^x86_64/ ? 157');
    expect(REAPER).toContain('syscall($n, 36, 1) == 0 or die');
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

  it.runIf(process.platform === 'linux' && process.arch === 'x64')('refuses to run without a subreaper: a failed prctl ends it before the command starts', () => {
    const broken = REAPER.replace('syscall($n, 36, 1)', 'syscall($n, 9999, 1)');
    const r = spawnSync('perl', ['-e', broken, 'sh', '-c', 'echo ran'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('no subreaper');
  });
});

describe('ending Chromium (D-44)', () => {
  it('kills the job user\'s processes and leaves the reaper to end; kills the reaper only when it does not', async () => {
    const calls: string[] = [];
    let end: () => void = () => undefined;
    const exited = new Promise<void>((r) => (end = r));
    await stopChrome({ proc: { kill: () => (calls.push('reaper'), true) }, exited }, 10002, 10002, (uid, gid) => (calls.push(`uid ${uid}:${gid}`), end(), 4));
    expect(calls).toEqual(['uid 10002:10002']);
    calls.length = 0;
    await stopChrome({ proc: { kill: () => (calls.push('reaper'), true) }, exited: new Promise(() => undefined) }, 10002, 10002, (uid, gid) => (calls.push(`uid ${uid}:${gid}`), 0), 1);
    expect(calls).toEqual(['uid 10002:10002', 'uid 10002:10002', 'uid 10002:10002', 'reaper']);
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
