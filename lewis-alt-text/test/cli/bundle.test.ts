/**
 * The downloadable single file, end to end: built by scripts/build-cli.mjs,
 * copied alone into an empty folder as a download would be, and run with
 * Node under the names a browser or a person might give it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { INSTRUCTIONS_URL } from '../../src/core/remote';

const ROOT = path.join(__dirname, '..', '..');
let dl: string;
let built: string;

function node(args: string[], o: { env?: Record<string, string>; input?: string } = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: dl,
    encoding: 'utf8',
    input: o.input ?? '',
    env: { ...process.env, LEWIS_ALT_TEXT_HOME: path.join(dl, 'home'), NODE_OPTIONS: '', ...o.env },
    timeout: 20_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'lat-build-'));
  built = path.join(outDir, 'lewis-alt-text.mjs');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-cli.mjs'), built], { cwd: ROOT });
  dl = mkdtempSync(path.join(os.tmpdir(), 'lat-download-'));
  copyFileSync(built, path.join(dl, 'lewis-alt-text.mjs'));
}, 30_000);

describe('the single file', () => {
  it('stands alone: no imports, the skill and the instructions address built in', () => {
    const text = readFileSync(built, 'utf8');
    expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(text).not.toMatch(/^(import|export) /m);
    expect(text).toContain(INSTRUCTIONS_URL);
    expect(text).toContain('Lewis Structure');
    expect(text).toContain('https://auth.hintwise.org');
  });

  it.each(['lewis-alt-text.mjs', 'lewis-alt-text (1).mjs', 'lewis-alt-text.js', 'lewis-alt-text', 'lewis-alt-text.mjs.txt', 'lewis-alt-text.cjs'])(
    'runs when saved as %s',
    (name) => {
      copyFileSync(built, path.join(dl, name));
      const v = node([name, '--version']);
      expect(v.err).toBe('');
      expect(v.out).toMatch(/^lewis-alt-text \d+\.\d+\.\d+ \(built \d{4}-\d\d-\d\d\)\n$/);
      expect(v.code).toBe(0);
    },
  );

  it('shows the command as the person typed it', () => {
    copyFileSync(built, path.join(dl, 'lewis-alt-text (1).mjs'));
    expect(node(['lewis-alt-text (1).mjs', '--help']).out).toContain('node "lewis-alt-text (1).mjs" figure.png');
    mkdirSync(path.join(dl, 'tools'), { recursive: true });
    copyFileSync(built, path.join(dl, 'tools', 'lat.mjs'));
    expect(node([path.join('tools', 'lat.mjs'), 'status']).out).toBe(`Not signed in. To sign in, run: node ${path.join('tools', 'lat.mjs')} login\n`);
  });

  it('explains mistakes without a stack trace', () => {
    const missing = node(['lewis-alt-text.mjs', 'figure.png']);
    expect(missing).toMatchObject({ code: 1, out: '', err: 'error: figure.png: no such file\n' });
    const signedOut = node(['lewis-alt-text.mjs', path.join(ROOT, 'test', 'fixtures', 'dot-cl.png')]);
    expect(signedOut.code).toBe(1);
    expect(signedOut.err).toMatch(/^This computer is not signed in to HintWise\. Run: node lewis-alt-text\.mjs login\n/);
    const noCode = node(['lewis-alt-text.mjs', 'login']);
    expect(noCode.code).toBe(1);
    expect(noCode.err).toMatch(/Open https:\/\/lewis-alt-text\.hintwise\.org\/terminal\/[\s\S]*No code was entered/);
  });

  it('tells someone with a Node.js that is too old what to install', () => {
    const preload = path.join(dl, 'old-node.cjs');
    writeFileSync(preload, 'delete process.getBuiltinModule;\n');
    const r = node(['--require', preload, 'lewis-alt-text.mjs', '--help']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^lewis-alt-text needs a newer Node\.js: this computer has Node\.js v[\d.]+\.\nInstall the LTS version from https:\/\/nodejs\.org/);
  });
});

describe.skipIf(!process.features.typescript || process.platform === 'win32')('cli/lewis-alt-text, from a clone', () => {
  it('runs the TypeScript source', () => {
    const r = spawnSync(path.join(ROOT, 'cli', 'lewis-alt-text'), ['--version'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout).toMatch(/^lewis-alt-text \d+\.\d+\.\d+ \(from source\)\n$/);
    const help = spawnSync(path.join(ROOT, 'cli', 'lewis-alt-text'), ['--help'], { cwd: ROOT, encoding: 'utf8' });
    expect(help.stdout).toContain(`  ${path.join('cli', 'lewis-alt-text')} figure.png`);
  });
});
