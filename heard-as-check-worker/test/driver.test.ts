/** The driver's parts that need no Chromium: the loopback server, Chromium's flags, the sandbox facts (AC-14, AC-15). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromeArgs, hasHeading, resolveStatic, sandboxFacts, staticServer } from '../src/driver.ts';

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
