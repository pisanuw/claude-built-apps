import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModelRequest } from '../../src/core/alt-text';
import { MAX_SEND_BYTES } from '../../src/core/image';
import type { Session, SessionStore } from '../../src/core/remote';
import {
  API_MAX_BYTES,
  checkKey,
  choice,
  expandInputs,
  fsMessage,
  helpText,
  hintwiseConfig,
  loadImage,
  main,
  ModeUnavailable,
  resolveModel,
  usingLine,
  type CliDeps,
  type FitImage,
} from '../../src/cli/main';
import { PURPOSES } from '../../src/core/request';

const CODE = 'a'.repeat(56);
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'dot-cl.png');
let dir: string;
let fig: string;
let figs: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lat-main-'));
  fig = path.join(dir, 'fig.png');
  copyFileSync(FIXTURE, fig);
  figs = path.join(dir, 'figs');
  mkdirSync(figs);
  for (const n of ['fig10.png', 'fig2.png', 'photo.HEIC', 'notes.txt', '.hidden.png']) copyFileSync(FIXTURE, path.join(figs, n));
  mkdirSync(path.join(dir, 'empty-folder'));
  writeFileSync(path.join(dir, 'empty.png'), '');
  writeFileSync(path.join(dir, 'notes.png'), 'not an image at all');
  const big = new Uint8Array(MAX_SEND_BYTES + 1000);
  big.set([0x89, 0x50, 0x4e, 0x47]);
  writeFileSync(path.join(dir, 'big.png'), big);
});

function memStore(initial: Session | null): SessionStore & { file: string; value: Session | null } {
  const s = {
    file: '/home/ann/.config/lewis-alt-text/session.json',
    value: initial,
    load: async () => s.value,
    save: async (v: Session) => void (s.value = v),
    clear: async () => void (s.value = null),
  };
  return s;
}

type Reply = { status: number; body?: unknown };
const signedIn = (): Session => ({ accessToken: 'acc', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, email: 'ann@example.com' });
const authBody = { access_token: 'acc2', refresh_token: 'ref2', expires_in: 3600, user: { email: 'ann@example.com' } };
const reply = (text: string, stop = 'end_turn'): Reply => ({ status: 200, body: { content: [{ type: 'text', text }], model: 'claude-opus-5-5', stop_reason: stop } });
const ALT = 'A chlorine atom, C l, with seven dots around it.';

interface Setup {
  argv: string[];
  replies?: Reply[];
  session?: Session | null;
  answers?: Array<string | null>;
  secrets?: Array<string | null>;
  interactive?: boolean;
  fit?: FitImage;
  subscription?: CliDeps['subscription'];
  ownGenerate?: CliDeps['subscription'];
  config?: CliDeps['config'];
  env?: CliDeps['env'];
}

function setup(o: Setup) {
  const out: string[] = [];
  const err: string[] = [];
  const answers = [...(o.answers ?? [])];
  const replies = [...(o.replies ?? [])];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = replies.shift();
    if (!r) throw new Error('no more replies');
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  });
  const store = memStore(o.session === undefined ? signedIn() : o.session);
  const subscription = vi.fn(o.subscription ?? (async () => ({ text: ALT, stopReason: 'end_turn' })));
  const own = vi.fn(o.ownGenerate ?? (async () => ({ text: ALT, stopReason: 'end_turn', usage: { input_tokens: 100, cache_read_input_tokens: 12_300, output_tokens: 400 } })));
  const ownKey = vi.fn(async () => own);
  const ask = vi.fn(async () => (answers.length ? (answers.shift() ?? null) : null));
  const secrets = [...(o.secrets ?? [])];
  const askSecret = vi.fn(async () => (secrets.length ? (secrets.shift() ?? null) : null));
  const deps: CliDeps = {
    argv: o.argv,
    program: 'node lat.mjs',
    version: '9.9.9',
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t), ask, askSecret, interactive: o.interactive ?? false },
    skill: async () => 'name: test\n---\nThe skill.',
    config: o.config ?? (() => ({ supabaseUrl: 'https://auth.example', anonKey: 'anon' })),
    store,
    subscription,
    ownKey,
    fetch: fetch as unknown as typeof globalThis.fetch,
    fit: o.fit,
    env: o.env ?? {},
    homedir: dir,
    platform: 'linux',
  };
  return { run: () => main(deps), out, err, calls, store, subscription, own, ownKey, ask, askSecret, text: () => [...out, ...err].join('\n') };
}

describe('help and version', () => {
  it('shows help with the command the person typed, and exits 1 without arguments', async () => {
    const t = setup({ argv: [] });
    expect(await t.run()).toBe(1);
    expect(t.out[0]).toContain('node lat.mjs figure.png');
    expect(t.out[0]).toContain('question | answer-key');
  });
  it('--help exits 0, --version prints the version', async () => {
    expect(await setup({ argv: ['--help'] }).run()).toBe(0);
    const v = setup({ argv: ['-v'] });
    expect(await v.run()).toBe(0);
    expect(v.out).toEqual(['lewis-alt-text 9.9.9']);
  });
  it('explains an unknown option in one sentence', async () => {
    const t = setup({ argv: ['--frob'] });
    expect(await t.run()).toBe(1);
    expect(t.err[0]).toMatch(/^Unknown option '--frob'\nTo see the options, run: node lat\.mjs --help$/);
  });
  it('lists the commands and the instructions address', () => {
    expect(helpText('x')).toMatch(/login[\s\S]*status[\s\S]*logout[\s\S]*Instructions: https:\/\//);
  });
});

describe('options', () => {
  it('forgives case, spaces and common short forms', () => {
    expect(choice(undefined, PURPOSES, '--purpose')).toBe('unknown');
    expect(choice(' Answer Key ', PURPOSES, '--purpose')).toBe('answer-key');
    expect(choice('answer', PURPOSES, '--purpose', { answer: 'answer-key' })).toBe('answer-key');
    expect(() => choice('maybe', PURPOSES, '--purpose')).toThrow('--purpose must be one of: question, answer-key (you gave "maybe").');
  });
  it('takes opus, sonnet, haiku or a full model id', () => {
    expect(resolveModel(undefined)).toBe('claude-opus-5-5');
    expect(resolveModel('Sonnet')).toBe('claude-sonnet-5-5');
    expect(resolveModel('claude-haiku-5-5')).toBe('claude-haiku-5-5');
    expect(() => resolveModel('gpt')).toThrow(/--model must be opus, sonnet or haiku/);
  });
  it('stops on a bad option before signing in or reading images', async () => {
    for (const argv of [[fig, '--purpose', 'maybe'], [fig, '--focus', 'colour'], [fig, '--model', 'gpt'], [fig, '--context', 'x'.repeat(2001)]]) {
      const t = setup({ argv, session: null });
      expect(await t.run()).toBe(1);
      expect(t.err[0]).toMatch(/^error: /);
      expect(t.calls).toHaveLength(0);
    }
  });
  it('passes purpose, focus, context and model to the request', async () => {
    const t = setup({ argv: [fig, '-p', 'answer', '-f', 'formal charges', '-c', 'HW 3', '-m', 'haiku', '--use-local-subscription'] });
    expect(await t.run()).toBe(0);
    const req = t.subscription.mock.calls[0][0] as ModelRequest;
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.messages[0].content[1].text).toMatch(/answer key[\s\S]*formal charges[\s\S]*HW 3/);
  });
  it('reads the model from LEWIS_MODEL', async () => {
    const t = setup({ argv: [fig, '--use-local-subscription'], env: { LEWIS_MODEL: 'sonnet' } });
    await t.run();
    expect((t.subscription.mock.calls[0][0] as ModelRequest).model).toBe('claude-sonnet-5-5');
  });
});

describe('login', () => {
  it('takes the code as an argument and says what to do next', async () => {
    const t = setup({ argv: ['login', CODE], session: null, replies: [{ status: 200, body: authBody }] });
    expect(await t.run()).toBe(0);
    expect(t.calls[0].url).toBe('https://auth.example/auth/v1/verify');
    expect(t.store.value?.accessToken).toBe('acc2');
    expect(t.err.join('\n')).toMatch(/Signed in as ann@example\.com\. The sign-in is saved in \/home\/ann[\s\S]*Next, write alt text: node lat\.mjs figure\.png/);
    expect(t.ask).not.toHaveBeenCalled();
  });
  it('asks for the code, and asks again after a mistake', async () => {
    const t = setup({ argv: ['LOGIN'], session: null, interactive: true, answers: ['', 'not a code!', CODE], replies: [{ status: 200, body: authBody }] });
    expect(await t.run()).toBe(0);
    expect(t.err[0]).toContain('https://lewis-alt-text.hintwise.org/terminal/');
    expect(t.err.filter((l) => l.includes('Try again'))).toHaveLength(2);
  });
  it('gives up after three mistakes', async () => {
    const t = setup({ argv: ['login'], session: null, interactive: true, answers: ['x', 'y', 'z'] });
    expect(await t.run()).toBe(1);
    expect(t.err.at(-1)).toMatch(/^error: That is not a sign-in code/);
  });
  it('asks once when the input is not a terminal, and says so when it ends', async () => {
    const t = setup({ argv: ['login'], session: null, answers: [CODE], replies: [{ status: 400, body: {} }] });
    expect(await t.run()).toBe(1);
    expect(t.err.at(-1)).toMatch(/expired or was already used/);
    const eof = setup({ argv: ['login'], session: null, interactive: true, answers: [null] });
    expect(await eof.run()).toBe(1);
    expect(eof.err.at(-1)).toBe('No code was entered, so this computer is not signed in.');
  });
  it('does not ask again when the code came as an argument', async () => {
    const t = setup({ argv: ['login', '--code', 'nope'], session: null, interactive: true });
    expect(await t.run()).toBe(1);
    expect(t.ask).not.toHaveBeenCalled();
  });
  it('reports settings it cannot read', async () => {
    const t = setup({ argv: ['login', CODE], config: () => hintwiseConfig('nothing here') });
    expect(await t.run()).toBe(1);
    expect(t.err).toEqual(['error: could not read the HintWise sign-in settings']);
  });
});

describe('status and logout', () => {
  it('says how to sign in when signed out', async () => {
    const t = setup({ argv: ['status'], session: null });
    expect(await t.run()).toBe(1);
    expect(t.out).toEqual(['Not signed in. To sign in, run: node lat.mjs login']);
  });
  it('shows what is left of the allowance', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ allowed: true, calls_left: 3, resets_at: '2030-01-01T00:00:00Z' }, /Signed in as ann@example\.com\. 3 alt texts left; more at /],
      [{ allowed: true, calls_left: 1 }, /1 alt text left\.$/],
      [{ allowed: true }, /The HintWise key is available\./],
      [{ allowed: false, scope: 'user-day' }, /daily HintWise allowance is used up/],
      [{ allowed: false }, /not available right now/],
    ];
    for (const [body, want] of cases) {
      const t = setup({ argv: ['status'], replies: [{ status: 200, body }] });
      expect(await t.run()).toBe(0);
      expect(t.out[0]).toMatch(want);
    }
    const anon = setup({ argv: ['status'], session: { ...signedIn(), email: null }, replies: [{ status: 200, body: { allowed: true } }] });
    await anon.run();
    expect(anon.out[0]).toMatch(/^Signed in\. /);
  });
  it('signs out, or says it was not signed in', async () => {
    const t = setup({ argv: ['logout'], replies: [{ status: 204 }] });
    expect(await t.run()).toBe(0);
    expect(t.err[0]).toMatch(/^Signed out/);
    expect(t.store.value).toBeNull();
    const none = setup({ argv: ['logout'], session: null });
    expect(await none.run()).toBe(0);
    expect(none.err[0]).toBe('This computer was not signed in.');
  });
});

describe('alt text through the live app', () => {
  it('writes alt text for one image', async () => {
    const t = setup({ argv: [fig], replies: [reply(ALT)] });
    expect(await t.run()).toBe(0);
    expect(t.out).toEqual([ALT]);
    expect(t.err).toEqual(['Using: the free HintWise allowance (signed in as ann@example.com). To pay another way, see --help.']);
    expect(t.calls[0].url).toBe('https://auth.example/functions/v1/llm-gateway');
    expect(t.calls[0].body).toMatchObject({ app: 'lewis-alt-text', model: 'claude-opus-5-5' });
  });
  it('does every image in a folder, in name order, with a heading each', async () => {
    const t = setup({ argv: [figs], replies: [reply(ALT), reply(ALT)] });
    expect(await t.run()).toBe(0);
    expect(t.out).toEqual([`== ${path.join(figs, 'fig2.png')} ==`, ALT, `== ${path.join(figs, 'fig10.png')} ==`, ALT]);
  });
  it('prints JSON lines with --json', async () => {
    const t = setup({ argv: [fig, path.join(dir, 'missing.png'), '--json'], replies: [reply(ALT)] });
    expect(await t.run()).toBe(1);
    const lines = t.out.map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ file: fig, kind: 'alt', altText: ALT });
    expect(lines[1]).toMatchObject({ kind: 'error', message: 'no such file' });
  });
  it('shows warnings, the audit, and questions', async () => {
    const warn = setup({ argv: [fig], replies: [reply('A double bond joins O and H2O.')] });
    expect(await warn.run()).toBe(0);
    expect(warn.err.some((l) => l.startsWith('warning: Names a bond type'))).toBe(true);
    const audit = setup({ argv: [fig, '-a'], replies: [reply(`Audit\nCl: 7 dots\nAlt text\n${ALT}`)] });
    await audit.run();
    expect(audit.err[1]).toMatch(/^--- audit ---\nCl: 7 dots/);
    const q = setup({ argv: [fig], replies: [reply('QUESTION: Is this a question or an answer key?')] });
    expect(await q.run()).toBe(2);
    expect(q.out).toEqual(['QUESTION: Is this a question or an answer key?']);
    expect(q.err[1]).toMatch(/--context/);
  });
  it('lets an error outrank a question', async () => {
    const t = setup({ argv: [fig, fig], replies: [reply('QUESTION: Which?'), reply('ERROR: no image')] });
    expect(await t.run()).toBe(1);
    expect(t.err.at(-1)).toBe(`error: ${fig}: no image`);
  });
  it('stops at a reached allowance and says how many were not done', async () => {
    const t = setup({ argv: [fig, fig, fig], replies: [reply(ALT), { status: 429, body: { error: 'cap', scope: 'user-day' } }] });
    expect(await t.run()).toBe(1);
    expect(t.text()).toMatch(/daily HintWise allowance is used up[\s\S]*Or pay another way: --use-local-subscription or --use-own-key/);
    expect(t.err.at(-1)).toBe('Stopped; 1 more image was not done.');
  });
});

describe('signing in on the way', () => {
  it('without a terminal: says how to sign in, and about --local', async () => {
    const t = setup({ argv: [fig], session: null });
    expect(await t.run()).toBe(1);
    expect(t.err[0]).toBe(
      'This computer is not signed in to HintWise. Run: node lat.mjs login\nOr pay another way: --use-local-subscription (Claude Code) or --use-own-key (your Anthropic API key).',
    );
  });
  it('at a terminal: signs in first, then writes the alt text', async () => {
    const t = setup({ argv: [fig], session: null, interactive: true, answers: [CODE], replies: [{ status: 200, body: authBody }, reply(ALT)] });
    expect(await t.run()).toBe(0);
    expect(t.err[0]).toMatch(/not signed in to HintWise yet/);
    expect(t.err.join('\n')).not.toMatch(/Next, write alt text/);
    expect(t.err).toContain('Using: the free HintWise allowance (signed in as ann@example.com). To pay another way, see --help.');
    expect(t.out).toEqual([ALT]);
  });
  it('at a terminal: stops when the sign-in does not happen', async () => {
    const t = setup({ argv: [fig], session: null, interactive: true, answers: [null] });
    expect(await t.run()).toBe(1);
  });
  it('does not ask anyone to sign in just to report missing files', async () => {
    const t = setup({ argv: ['logn'], session: null, interactive: true });
    expect(await t.run()).toBe(1);
    expect(t.err).toEqual(['error: logn: no such file, and not a command (the commands are login, status, logout)']);
    expect(t.ask).not.toHaveBeenCalled();
  });
  it('hints at quotes when --context words became file names', async () => {
    const t = setup({ argv: [fig, '--context', 'HW', '3'], replies: [reply(ALT)] });
    expect(await t.run()).toBe(1);
    expect(t.err[0]).toMatch(/^hint: .*in quotes/);
  });
  it('passes on errors other than being signed out', async () => {
    const t = setup({ argv: [fig], session: { ...signedIn(), expiresAt: 0 }, replies: [{ status: 500, body: { message: 'down' } }] });
    expect(await t.run()).toBe(1);
    expect(t.err).toEqual(['error: down']);
  });
});

describe('--use-local-subscription', () => {
  it('uses Claude Code, says so, and needs no network', async () => {
    const t = setup({ argv: [fig, '--use-local-subscription'], session: null });
    expect(await t.run()).toBe(0);
    expect(t.out).toEqual([ALT]);
    expect(t.err).toEqual([usingLine('subscription', null)]);
    expect(t.calls).toHaveLength(0);
  });
  it('still takes the old --local, with a note', async () => {
    const t = setup({ argv: [fig, '-l'], session: null });
    expect(await t.run()).toBe(0);
    expect(t.err[0]).toBe('note: --local is now called --use-local-subscription.');
    expect(t.subscription).toHaveBeenCalledTimes(1);
  });
  it('stops when Claude Code cannot run', async () => {
    const t = setup({
      argv: [fig, fig, '--use-local-subscription'],
      subscription: async () => {
        throw new ModeUnavailable('--use-local-subscription needs Claude Code');
      },
    });
    expect(await t.run()).toBe(1);
    expect(t.subscription).toHaveBeenCalledTimes(1);
    expect(t.err.at(-1)).toBe('Stopped; 1 more image was not done.');
  });
  it('allows images up to the API limit', async () => {
    const t = setup({ argv: [path.join(dir, 'big.png'), '--use-local-subscription'] });
    expect(await t.run()).toBe(0);
  });
  it('cannot be combined with --use-own-key', async () => {
    const t = setup({ argv: [fig, '--use-local-subscription', '--use-own-key'] });
    expect(await t.run()).toBe(1);
    expect(t.err).toEqual(['error: Choose one: --use-local-subscription or --use-own-key.']);
  });
});

describe('--use-own-key', () => {
  const KEY = 'sk-ant-api03-abcdefghijklmnopWXYZ';
  it('uses the key from ANTHROPIC_API_KEY, says so, and adds up what was billed', async () => {
    const t = setup({ argv: [fig, fig, '--use-own-key'], session: null, env: { ANTHROPIC_API_KEY: ` ${KEY}\n` } });
    expect(await t.run()).toBe(0);
    expect(t.ownKey).toHaveBeenCalledWith(KEY);
    expect(t.err[0]).toBe('Using: your own Anthropic API key (ending WXYZ, from ANTHROPIC_API_KEY). Anthropic bills this key for each image.');
    expect(t.err.at(-1)).toBe('Billed to your key: 2 requests, 24,800 input tokens (24,600 of them read from the cache, which costs less), 800 output tokens.');
    expect(t.calls).toHaveLength(0);
  });
  it('asks for the key, hidden, when the variable is not set', async () => {
    const t = setup({ argv: [fig, '--use-own-key'], interactive: true, secrets: [KEY] });
    expect(await t.run()).toBe(0);
    expect(t.askSecret).toHaveBeenCalledWith(expect.stringMatching(/not shown, not saved/));
    expect(t.err[0]).toBe('Using: your own Anthropic API key (ending WXYZ). Anthropic bills this key for each image.');
    expect(t.err.at(-1)).toMatch(/^Billed to your key: 1 request, /);
  });
  it('explains a missing, empty or wrong key', async () => {
    const piped = setup({ argv: [fig, '--use-own-key'] });
    expect(await piped.run()).toBe(1);
    expect(piped.err).toEqual(['error: --use-own-key needs your Anthropic API key in the ANTHROPIC_API_KEY environment variable.']);
    const empty = setup({ argv: [fig, '--use-own-key'], interactive: true, secrets: [''] });
    expect(await empty.run()).toBe(1);
    expect(empty.err).toEqual(['No key was entered.']);
    const wrong = setup({ argv: [fig, '--use-own-key'], interactive: true, secrets: ['hunter2'] });
    expect(await wrong.run()).toBe(1);
    expect(wrong.err[0]).toMatch(/^error: That does not look like an Anthropic API key; those start with sk-ant-/);
    expect(wrong.ownKey).not.toHaveBeenCalled();
  });
  it('does not ask for a key when there is no image to send', async () => {
    const t = setup({ argv: ['missing.png', '--use-own-key'], interactive: true });
    expect(await t.run()).toBe(1);
    expect(t.askSecret).not.toHaveBeenCalled();
  });
  it('stops at a refused key, and prints no bill when nothing was billed', async () => {
    const t = setup({
      argv: [fig, fig, '--use-own-key'],
      env: { ANTHROPIC_API_KEY: KEY },
      ownGenerate: async () => {
        throw new ModeUnavailable('Anthropic did not accept this API key.');
      },
    });
    expect(await t.run()).toBe(1);
    expect(t.err.slice(1)).toEqual([`error: ${fig}: Anthropic did not accept this API key.`, 'Stopped; 1 more image was not done.']);
  });
  it('checkKey and usingLine', () => {
    expect(checkKey(`  ${KEY} `)).toBe(KEY);
    expect(() => checkKey('sk-ant-')).toThrow(/does not look like/);
    expect(usingLine('hintwise', null)).toBe('Using: the free HintWise allowance. To pay another way, see --help.');
    expect(usingLine('own-key', null)).toBe('Using: your own Anthropic API key. Anthropic bills this key for each image.');
  });
});

describe('expandInputs', () => {
  it('expands folders, wildcards and ~, skipping other files', async () => {
    const got = await expandInputs([figs, path.join(figs, 'FIG*.png'), '~/fig.png'], { homedir: dir });
    expect(got.map((i) => path.relative(dir, i.file))).toEqual([
      path.join('figs', 'fig2.png'),
      path.join('figs', 'fig10.png'),
      path.join('figs', 'fig2.png'),
      path.join('figs', 'fig10.png'),
      'fig.png',
    ]);
    expect(got.every((i) => !i.error)).toBe(true);
  });
  it('includes HEIC and the like only when they can be converted', async () => {
    const got = await expandInputs([figs], { convertible: true });
    expect(got.map((i) => path.basename(i.file))).toEqual(['fig2.png', 'fig10.png', 'photo.HEIC']);
  });
  it('explains what matched nothing', async () => {
    const got = await expandInputs([
      path.join(dir, 'empty-folder'),
      path.join(figs, '*.gif'),
      path.join(dir, 'nowhere', '*.png'),
      path.join(dir, 'missing.png'),
      'statuss',
      'https://example.edu/figure.png',
      os.platform() === 'win32' ? fig : '/dev/null',
    ]);
    expect(got.map((i) => i.error)).toEqual([
      'no images in this folder (it looks for .png, .jpg, .gif and .webp files)',
      'no images match this',
      'no such file',
      'no such file',
      'no such file, and not a command (the commands are login, status, logout)',
      'that is a web address. Save the image to this computer first, then give its file name.',
      os.platform() === 'win32' ? undefined : 'not a file',
    ]);
  });
});

describe('loadImage', () => {
  const opts = { limit: MAX_SEND_BYTES, mode: 'hintwise' as const };
  it('reads a supported image as is', async () => {
    const img = await loadImage(fig, opts);
    expect(img.mediaType).toBe('image/png');
    expect(img.note).toBeUndefined();
  });
  it('explains empty, unsupported, missing and too-large files', async () => {
    await expect(loadImage(path.join(dir, 'empty.png'), opts)).rejects.toThrow('the file is empty');
    await expect(loadImage(path.join(dir, 'notes.png'), opts)).rejects.toThrow(/not a PNG, JPEG, GIF or WebP image/);
    await expect(loadImage(path.join(dir, 'missing.png'), opts)).rejects.toThrow('no such file');
    await expect(loadImage(path.join(dir, 'big.png'), opts)).rejects.toThrow(/681 kB, and the live app takes up to 680 kB[\s\S]*web app/);
    await expect(loadImage(path.join(dir, 'big.png'), { limit: 1000, mode: 'own-key' })).rejects.toThrow(/681 kB, and Anthropic takes up to 1 kB\. Crop it/);
    expect(API_MAX_BYTES).toBe(3_932_160);
  });
  it('uses the image converter when there is one', async () => {
    const small = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const fit = vi.fn<FitImage>(async () => ({ bytes: small, note: 'made smaller' }));
    const img = await loadImage(path.join(dir, 'big.png'), { ...opts, fit });
    expect(img).toMatchObject({ mediaType: 'image/png', note: 'made smaller' });
    const t = setup({ argv: [path.join(dir, 'big.png')], fit, replies: [reply(ALT)] });
    expect(await t.run()).toBe(0);
    expect(t.err[1]).toMatch(/^note: .*big\.png: made smaller$/);
    const none = vi.fn<FitImage>(async () => null);
    await expect(loadImage(path.join(dir, 'notes.png'), { ...opts, fit: none })).rejects.toThrow(/not a PNG/);
  });
});

describe('fsMessage', () => {
  it('puts file errors in words', () => {
    const e = (code: string) => Object.assign(new Error(`raw ${code}`), { code });
    expect(fsMessage(e('EISDIR'))).toBe('that is a folder, not a file');
    expect(fsMessage(e('EPERM'), 'darwin')).toMatch(/Privacy & Security/);
    expect(fsMessage(e('EPERM'), 'linux')).toMatch(/permission denied/);
    expect(fsMessage(e('EACCES'), 'linux')).toMatch(/permission denied/);
    expect(fsMessage(e('EIO'))).toBe('raw EIO');
    expect(fsMessage('odd')).toBe('odd');
  });
});

describe('hintwiseConfig', () => {
  const yml = 'env:\n  VITE_SUPABASE_URL: https://auth.example\n  VITE_SUPABASE_ANON_KEY: anon123\n';
  it('reads the public values from target.yml, or the environment', () => {
    expect(hintwiseConfig(yml)).toEqual({ supabaseUrl: 'https://auth.example', anonKey: 'anon123' });
    expect(hintwiseConfig(yml, { LEWIS_SUPABASE_URL: 'https://other', LEWIS_SUPABASE_ANON_KEY: 'k' })).toEqual({ supabaseUrl: 'https://other', anonKey: 'k' });
  });
});
