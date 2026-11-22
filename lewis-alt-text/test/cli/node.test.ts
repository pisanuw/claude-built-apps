import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildRequest } from '../../src/core/alt-text';
import { LocalUnavailable } from '../../src/cli/main';
import { askLine, fileStore, generateWithClaude, programName, runFile, sessionDir, sipsFit, terminalIO, type Run } from '../../src/cli/node';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'dot-cl.png');
const posix = process.platform !== 'win32';
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lat-node-'));
});

describe('the session file', () => {
  it('lives in ~/.config/lewis-alt-text unless the environment says otherwise', () => {
    expect(sessionDir({}, '/home/ann')).toBe(path.join('/home/ann', '.config', 'lewis-alt-text'));
    expect(sessionDir({ XDG_CONFIG_HOME: '/cfg' }, '/home/ann')).toBe(path.join('/cfg', 'lewis-alt-text'));
    expect(sessionDir({ LEWIS_ALT_TEXT_HOME: '/x' }, '/home/ann')).toBe('/x');
  });
  it('saves, loads and clears a session, readable only by its owner', async () => {
    const store = fileStore(path.join(dir, 'store'));
    expect(await store.load()).toBeNull();
    const s = { accessToken: 'a', refreshToken: 'r', expiresAt: 1, email: null };
    await store.save(s);
    expect(await store.load()).toEqual(s);
    if (posix) expect(statSync(store.file).mode & 0o777).toBe(0o600);
    await store.clear();
    expect(existsSync(store.file)).toBe(false);
  });
  it('ignores a damaged file', async () => {
    const store = fileStore(path.join(dir, 'damaged'));
    await store.save({ accessToken: 'a', refreshToken: 'r', expiresAt: 1, email: null });
    writeFileSync(store.file, '{not json');
    expect(await store.load()).toBeNull();
    writeFileSync(store.file, '{"accessToken": 1}');
    expect(await store.load()).toBeNull();
  });
});

describe('the terminal', () => {
  it('reads one line, or null when the input ends', async () => {
    const input = new PassThrough();
    const pending = askLine(input, new PassThrough(), 'Code: ');
    input.write('abc\n');
    expect(await pending).toBe('abc');
    const closed = new PassThrough();
    const none = askLine(closed, new PassThrough(), 'Code: ');
    closed.end();
    expect(await none).toBeNull();
  });
  it('writes lines to stdout and stderr', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const io = terminalIO({ stdin, stdout, stderr } as unknown as NodeJS.Process);
    io.out('alt');
    io.err('note');
    expect(String(stdout.read())).toBe('alt\n');
    expect(String(stderr.read())).toBe('note\n');
    expect(io.interactive).toBe(true);
    const asked = io.ask('Code: ');
    stdin.write('xyz\n');
    expect(await asked).toBe('xyz');
  });
});

describe('programName', () => {
  it('shows the path from the current folder, quoted when needed', () => {
    const cwd = path.resolve('/work');
    expect(programName(path.join(cwd, 'lewis-alt-text.mjs'), { cwd, viaNode: true })).toBe('node lewis-alt-text.mjs');
    expect(programName(path.join(cwd, 'lewis-alt-text (1).mjs'), { cwd, viaNode: true })).toBe('node "lewis-alt-text (1).mjs"');
    expect(programName(path.join(cwd, 'tools', 'lat.mjs'), { cwd, viaNode: true })).toBe(`node ${path.join('tools', 'lat.mjs')}`);
    const elsewhere = path.resolve('/Users/Ann Lee/Downloads/lewis-alt-text.mjs');
    expect(programName(elsewhere, { cwd, viaNode: true })).toBe(`node "${elsewhere}"`);
  });
  it('runs an executable from the current folder with ./', () => {
    const cwd = path.resolve('/repo');
    expect(programName(path.join(cwd, 'cli', 'lewis-alt-text'), { cwd, viaNode: false })).toBe(path.join('cli', 'lewis-alt-text'));
    expect(programName(path.join(cwd, 'lewis-alt-text'), { cwd, viaNode: false })).toBe('./lewis-alt-text');
  });
});

describe.skipIf(!posix)('generateWithClaude', () => {
  const req = buildRequest({ base64: 'AAAA', mediaType: 'image/png', skill: 'skill', model: 'claude-sonnet-5-5' });
  // A stand-in for the claude CLI: prints `lines` as stream-json, after checking its arguments.
  function fakeClaude(name: string, body: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, `#!${process.execPath}\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  }

  it('sends the request and reads the result', async () => {
    const bin = fakeClaude(
      'ok',
      `const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const fs = require('node:fs');
  const system = fs.readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8');
  const msg = JSON.parse(input).message;
  console.log('not json');
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: args[args.indexOf('--model') + 1] + '|' + system.slice(0, 5) + '|' + msg.role,
    stop_reason: 'end_turn', modelUsage: { 'claude-sonnet-5-5': {} }, usage: { output_tokens: 9 } }));
});`,
    );
    const r = await generateWithClaude(req, { bin });
    expect(r).toEqual({ text: 'sonnet|skill|user', model: 'claude-sonnet-5-5', usage: { output_tokens: 9 }, stopReason: 'end_turn' });
  });
  it('says how to get Claude Code when it is missing', async () => {
    await expect(generateWithClaude(req, { bin: path.join(dir, 'no-such-claude') })).rejects.toThrow(LocalUnavailable);
  });
  it('treats a signed-out Claude Code as unavailable, other failures as errors', async () => {
    const out = (o: object) => fakeClaude(`r${Math.random()}`, `process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(JSON.stringify(o))}));`);
    await expect(generateWithClaude(req, { bin: out({ type: 'result', is_error: true, result: 'Not logged in. Please run /login' }) })).rejects.toThrow(
      /Claude Code: Not logged in[\s\S]*on its own once to sign in/,
    );
    const other = generateWithClaude(req, { bin: out({ type: 'result', subtype: 'error_max_turns' }) });
    await expect(other).rejects.toThrow('Claude Code: error_max_turns');
    await expect(other).rejects.not.toBeInstanceOf(LocalUnavailable);
    await expect(generateWithClaude(req, { bin: out({ type: 'system' }) })).rejects.toThrow(/exited 0 without a result/);
  });
  it('stops a Claude Code that hangs', async () => {
    const bin = fakeClaude('slow', 'setTimeout(() => {}, 60_000);');
    await expect(generateWithClaude(req, { bin, timeoutMs: 200 })).rejects.toThrow(/stopped \(SIGTERM\) after 0.2 s/);
  });
});

describe('runFile', () => {
  it('reports the exit code and output, and 127 for a missing program', async () => {
    expect(await runFile(process.execPath, ['-e', 'process.stdout.write("hi")'])).toEqual({ code: 0, stdout: 'hi' });
    expect((await runFile(process.execPath, ['-e', 'process.exit(3)'])).code).toBe(3);
    expect((await runFile(path.join(dir, 'no-such-program'), [])).code).toBe(127);
  });
});

describe('sipsFit', () => {
  const png = (n: number) => {
    const b = new Uint8Array(n);
    b.set([0x89, 0x50, 0x4e, 0x47]);
    return b;
  };
  const jpeg = (n: number) => {
    const b = new Uint8Array(n);
    b.set([0xff, 0xd8, 0xff]);
    return b;
  };
  /** A pretend sips: answers -g with a size, and writes what `sizes` says for each conversion. */
  function fakeSips(o: { width?: number; height?: number; format?: string; infoCode?: number; sizes: Array<number | null> }) {
    const calls: string[][] = [];
    const run: Run = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === '-g') return { code: o.infoCode ?? 0, stdout: `pixelWidth: ${o.width ?? 3000}\n  pixelHeight: ${o.height ?? 2000}\n  format: ${o.format ?? 'png'}\n` };
      const size = o.sizes.shift();
      if (size === null || size === undefined) return { code: 13, stdout: '' };
      const out = args[args.indexOf('--out') + 1];
      writeFileSync(out, args[2] === 'png' ? png(size) : jpeg(size));
      return { code: 0, stdout: '' };
    };
    return { run, calls };
  }

  it('redraws a large image smaller as PNG, never enlarging', async () => {
    const s = fakeSips({ sizes: [500] });
    const r = await sipsFit(s.run, dir)(png(900_000), 680_000);
    expect(r?.note).toBe('made smaller to fit the size limit (PNG, 1568 x 1045 pixels, 1 kB)');
    expect(s.calls[1]).toEqual(expect.arrayContaining(['-s', 'format', 'png', '-Z', '1568']));
    const small = fakeSips({ width: 400, height: 300, format: 'tiff', sizes: [800] });
    const c = await sipsFit(small.run, dir)(new Uint8Array([1, 2, 3]), 680_000);
    expect(c?.note).toBe('converted from tiff (PNG, 400 x 300 pixels, 1 kB)');
    expect(small.calls[1]).not.toContain('-Z');
  });
  it('falls back to JPEG, then smaller JPEG', async () => {
    const s = fakeSips({ sizes: [900_000, 700_000, 600_000] });
    const r = await sipsFit(s.run, dir)(png(900_000), 680_000);
    expect(r?.note).toMatch(/^made smaller to fit the size limit \(JPEG, 1200 x 800 pixels, 600 kB\)$/);
    expect(s.calls[3]).toEqual(expect.arrayContaining(['-s', 'formatOptions', '75', '-Z', '1200']));
  });
  it('gives up when sips cannot read it or nothing fits', async () => {
    expect(await sipsFit(fakeSips({ infoCode: 13, sizes: [] }).run, dir)(png(10), 5)).toBeNull();
    expect(await sipsFit(fakeSips({ sizes: [null] }).run, dir)(png(10), 5)).toBeNull();
    expect(await sipsFit(fakeSips({ sizes: [900, 900, 900, 900] }).run, dir)(png(10), 5)).toBeNull();
  });
  it.skipIf(process.platform !== 'darwin')('works with the real sips', async () => {
    const big = path.join(dir, 'real-big.tiff');
    copyFileSync(FIXTURE, path.join(dir, 'real.png'));
    await runFile('sips', ['-Z', '3000', '-s', 'format', 'tiff', path.join(dir, 'real.png'), '--out', big]);
    const r = await sipsFit()(new Uint8Array(readFileSync(big)), 680_000);
    expect(r?.note).toMatch(/^converted from tiff \(PNG, 1568 x \d+ pixels/);
  });
});
