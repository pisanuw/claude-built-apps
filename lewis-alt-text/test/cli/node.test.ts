import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildRequest } from '../../src/core/alt-text';
import { ModeUnavailable } from '../../src/cli/main';
import {
  askLine,
  askSecret,
  fileStore,
  generateWithClaude,
  ownKeyGenerate,
  programName,
  runFile,
  sessionDir,
  sipsFit,
  subscriptionEnv,
  terminalIO,
  type Run,
} from '../../src/cli/node';

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
    await expect(generateWithClaude(req, { bin: path.join(dir, 'no-such-claude') })).rejects.toThrow(ModeUnavailable);
  });
  it('treats a signed-out Claude Code as unavailable, other failures as errors', async () => {
    const out = (o: object) => fakeClaude(`r${Math.random()}`, `process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(JSON.stringify(o))}));`);
    await expect(generateWithClaude(req, { bin: out({ type: 'result', is_error: true, result: 'Not logged in. Please run /login' }) })).rejects.toThrow(
      /Claude Code: Not logged in[\s\S]*on its own once to sign in/,
    );
    const other = generateWithClaude(req, { bin: out({ type: 'result', subtype: 'error_max_turns' }) });
    await expect(other).rejects.toThrow('Claude Code: error_max_turns');
    await expect(other).rejects.not.toBeInstanceOf(ModeUnavailable);
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

describe('askSecret', () => {
  function tty() {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
    const output = new PassThrough();
    return { input, output };
  }
  it('reads a key without echoing it: Backspace works, arrow keys are ignored', async () => {
    const { input, output } = tty();
    let shown = '';
    output.on('data', (d) => (shown += d));
    const pending = askSecret(input, output, 'Key: ');
    input.write('sk-ant-abc\u007fd\u001b[A');
    input.write('\r');
    expect(await pending).toBe('sk-ant-abd');
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(shown).toBe('Key: \n');
  });
  it('gives null on Ctrl+C, or Ctrl+D on an empty line', async () => {
    for (const keys of ['\u0003', '\u0004']) {
      const { input, output } = tty();
      const pending = askSecret(input, output, 'Key: ');
      input.write(keys);
      expect(await pending).toBeNull();
    }
  });
  it('reads a plain line when the input is not a terminal', async () => {
    const input = new PassThrough();
    const pending = askSecret(input, new PassThrough(), 'Key: ');
    input.write('sk-ant-piped\n');
    expect(await pending).toBe('sk-ant-piped');
  });
});

describe('subscriptionEnv', () => {
  it('drops every setting that would bill something other than the subscription', () => {
    const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1' };
    expect(subscriptionEnv(env)).toEqual({ PATH: '/bin' });
    expect(env.ANTHROPIC_API_KEY).toBe('k');
  });
});

describe.skipIf(!posix)('generateWithClaude on the subscription', () => {
  const req = buildRequest({ base64: 'AAAA', mediaType: 'image/png', skill: 'skill', model: 'claude-opus-5-5' });
  function fake(name: string, body: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, `#!${process.execPath}\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  }
  it('starts Claude Code without API keys in its environment', async () => {
    const bin = fake(
      'env-check',
      `process.stdin.resume(); process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none' }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: [process.env.ANTHROPIC_API_KEY ?? '-', process.env.KEEP].join(',') }));
});`,
    );
    const r = await generateWithClaude(req, { bin, env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-secret', KEEP: 'kept' } });
    expect(r.text).toBe('-,kept');
  });
  it('stops before sending anything when Claude Code says it would use an API key', async () => {
    const bin = fake(
      'key-source',
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'apiKeyHelper' }));
setTimeout(() => console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'sent anyway' })), 5000);`,
    );
    const started = Date.now();
    const p = generateWithClaude(req, { bin });
    await expect(p).rejects.toThrow(ModeUnavailable);
    await expect(p).rejects.toThrow(/set up to use an API key \(apiKeyHelper\), not your Claude subscription/);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

describe('ownKeyGenerate', () => {
  const req = (model = 'claude-opus-5-5') => buildRequest({ base64: 'AAAA', mediaType: 'image/png', skill: 'skill', model });
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'Alt ' }, { type: 'text', text: 'text.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  function fakeFetch(status: number, body: unknown) {
    const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
    });
    return { f: f as unknown as typeof fetch, seen };
  }
  const apiError = (type: string, msg: string) => ({ type: 'error', error: { type, message: msg } });

  it('calls the Messages API with the key, and the refusal fallback on Opus', async () => {
    const { f, seen } = fakeFetch(200, message);
    const generate = await ownKeyGenerate('sk-ant-test-key', { fetch: f, maxRetries: 0, baseURL: 'https://api.example' });
    const r = await generate(req());
    expect(r).toEqual({ text: 'Alt text.', model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
    expect(seen[0].url).toBe('https://api.example/v1/messages');
    // SDK 1.x sends an API key as a bearer token.
    expect(seen[0].headers.get('authorization')).toBe('Bearer sk-ant-test-key');
    expect(seen[0].headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(seen[0].body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 4096, fallbacks: 'default' });
  });
  it('sends no fallback for Haiku, which has none', async () => {
    const { f, seen } = fakeFetch(200, message);
    await (await ownKeyGenerate('sk-ant-test-key', { fetch: f, maxRetries: 0 }))(req('claude-haiku-5-5'));
    expect(seen[0].body.fallbacks).toBeUndefined();
    expect(seen[0].headers.get('anthropic-beta')).toBeNull();
  });
  it('turns API errors into words, stopping the run for the ones that repeat', async () => {
    const cases: Array<[number, unknown, RegExp, boolean]> = [
      [401, apiError('authentication_error', 'invalid x-api-key'), /did not accept this API key/, true],
      [403, apiError('permission_error', 'no access to this model'), /may not do that: no access to this model/, true],
      [429, apiError('rate_limit_error', 'slow down'), /limiting how fast/, true],
      [400, apiError('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), /^Anthropic: Your credit balance is too low/, false],
      [529, apiError('overloaded_error', 'Overloaded'), /^Anthropic: Overloaded$/, false],
    ];
    for (const [status, body, want, stops] of cases) {
      const { f } = fakeFetch(status, body);
      const p = (await ownKeyGenerate('sk-ant-test-key', { fetch: f, maxRetries: 0 }))(req());
      await expect(p).rejects.toThrow(want);
      await expect(p).rejects.toSatisfy((e: unknown) => (e instanceof ModeUnavailable) === stops);
    }
  });
  it('says when api.anthropic.com cannot be reached', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) });
    }) as unknown as typeof fetch;
    const p = (await ownKeyGenerate('sk-ant-test-key', { fetch: f, maxRetries: 0 }))(req());
    await expect(p).rejects.toThrow(ModeUnavailable);
    await expect(p).rejects.toThrow(/Could not reach api\.anthropic\.com/);
  });
});
