/**
 * AC-80: with VITE_COMPARE_PATCHED off (or unset), the built page holds no
 * "Compile patched and compare" control and no script of it; with it on, the
 * control's script is a chunk of its own. The fix cards and Compile and check
 * are in both builds. Two real `vite build`s, into temporary folders.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { CHECKER_ADDRESS, NOT_CALLED } from './checker-address';

const ROOT = path.join(__dirname, '..');
const dirs: string[] = [];

/** The files a browser loads: the page and its scripts, not the source maps. */
async function built(flag: string | undefined, checker = 'https://checker.example.org'): Promise<{ files: string[]; text: string }> {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'td-build-'));
  dirs.push(out);
  const saved = { ...process.env };
  process.env.VITE_CHECKER_URL = checker;
  process.env.VITE_COMPILE_CHECK = 'on';
  if (flag === undefined) delete process.env.VITE_COMPARE_PATCHED;
  else process.env.VITE_COMPARE_PATCHED = flag;
  try {
    await build({ root: ROOT, logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
  } finally {
    process.env = saved;
  }
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (!f.endsWith('.map')) files.push(path.relative(out, f));
    }
  };
  walk(out);
  return { files, text: files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') };
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('AC-80: the build flag of "Compile patched and compare"', () => {
  it('leaves the control and its script out of the page when off or unset, and puts them in when on', async () => {
    for (const flag of ['off', undefined]) {
      const off = await built(flag);
      expect(off.text).not.toContain('Compile patched and compare');
      expect(off.files.some((f) => /compare-.*\.js$/.test(f))).toBe(false);
      // The fix cards, the patched zip and Compile and check are still built.
      expect(off.text).toContain('Suggest fixes');
      expect(off.text).toContain('Download patched zip');
      expect(off.text).toContain('Compile and check');
    }
    const on = await built('on');
    expect(on.files.some((f) => /compare-.*\.js$/.test(f))).toBe(true);
    expect(on.text).toContain('Compile patched and compare');
  }, 240_000);

  it('AC-13 (CR-13): the build with deploy/target.yml\'s values calls the one checker address of this release step, and not the other', async () => {
    const target = fs.readFileSync(path.join(ROOT, 'deploy', 'target.yml'), 'utf8');
    const url = /^\s*VITE_CHECKER_URL:\s*(\S+)\s*$/m.exec(target)?.[1];
    expect(url).toBe(CHECKER_ADDRESS);
    // The deploy file's flag, as the live build gets it (D-152), on or off: the build matches it, so turning it
    // off again is one line in deploy/target.yml (R5a.F-5).
    const flag = /^\s*VITE_COMPARE_PATCHED:\s*'?(\w+)'?\s*$/m.exec(target)?.[1];
    expect(['on', 'off', undefined]).toContain(flag);
    const prod = await built(flag, url);
    if (flag === 'on') expect(prod.text).toContain('Compile patched and compare');
    else expect(prod.text).not.toContain('Compile patched and compare');
    expect(prod.text).toContain(CHECKER_ADDRESS);
    const host = new URL(CHECKER_ADDRESS).hostname;
    expect(prod.text).not.toContain(new URL(NOT_CALLED).hostname);
    const hosts = new Set([...prod.text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()));
    expect([...hosts].filter((h) => h.endsWith('onrender.com'))).toEqual([host]);
  }, 240_000);

  it('is named in .env.example (off for a local build) and set in the app\'s deploy file, on or off, in one line (AC-80, D-152, R5a.F-5)', () => {
    expect(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')).toMatch(/^VITE_COMPARE_PATCHED=off$/m);
    const target = fs.readFileSync(path.join(ROOT, 'deploy', 'target.yml'), 'utf8');
    expect(target.match(/^ {2}VITE_COMPARE_PATCHED: '(on|off)'$/gm)).toHaveLength(1);
  });
});
