/**
 * The Node side of the command-line tool: the session file, the terminal,
 * the two ways of paying for the model without HintWise (Claude Code on the
 * person's subscription, or their own API key), image conversion with
 * macOS's built-in sips, and how to show the command in messages.
 */
import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type Anthropic from '@anthropic-ai/sdk';
import type { Generate, ModelReply, ModelRequest } from '../core/alt-text.ts';
import { MAX_EDGE } from '../core/image.ts';
import { networkReason, type Session, type SessionStore } from '../core/remote.ts';
import { sniffType } from '../core/request.ts';
import { ModeUnavailable, type CliIO, type FitImage } from './main.ts';

type Env = Record<string, string | undefined>;

// --- The session file ------------------------------------------------------

/** ~/.config/lewis-alt-text (or $XDG_CONFIG_HOME, or $LEWIS_ALT_TEXT_HOME). */
export function sessionDir(env: Env = process.env, home: string = os.homedir()): string {
  if (env.LEWIS_ALT_TEXT_HOME) return env.LEWIS_ALT_TEXT_HOME;
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'lewis-alt-text');
}

/**
 * This computer's HintWise session, in a file only you can read (mode 600).
 * It holds a refresh token: treat it like a password. logout removes it.
 */
export function fileStore(dir: string = sessionDir()): SessionStore & { file: string } {
  const file = path.join(dir, 'session.json');
  return {
    file,
    async load() {
      if (!existsSync(file)) return null;
      try {
        const s = JSON.parse(readFileSync(file, 'utf8')) as Session | null;
        return s && typeof s.accessToken === 'string' && typeof s.refreshToken === 'string' ? s : null;
      } catch {
        return null;
      }
    },
    async save(s) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    },
    async clear() {
      rmSync(file, { force: true });
    },
  };
}

// --- The terminal ----------------------------------------------------------

/** One line from `input`; null when the input ends first (Ctrl+D, Ctrl+C, or a closed pipe). */
export function askLine(input: NodeJS.ReadableStream & { isTTY?: boolean }, output: NodeJS.WritableStream, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: input.isTTY === true });
    let answered = false;
    rl.on('close', () => {
      if (!answered) resolve(null);
    });
    rl.question(prompt, (line) => {
      answered = true;
      rl.close();
      resolve(line);
    });
  });
}

type SecretInput = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown };

/**
 * One line typed without echo, for an API key: in a terminal, characters are
 * read in raw mode and not shown (Backspace works, arrow keys are ignored).
 * Null on Ctrl+C, or Ctrl+D on an empty line. Elsewhere, a plain line.
 */
export function askSecret(input: SecretInput, output: NodeJS.WritableStream, prompt: string): Promise<string | null> {
  const setRaw = input.setRawMode;
  if (input.isTTY !== true || typeof setRaw !== 'function') return askLine(input, output, prompt);
  return new Promise((resolve) => {
    let value = '';
    let escape = false;
    const done = (v: string | null) => {
      input.off('data', onData);
      setRaw.call(input, false);
      input.pause();
      output.write('\n');
      resolve(v);
    };
    function onData(chunk: Buffer | string) {
      for (const ch of String(chunk)) {
        if (escape) {
          if (/[A-Za-z~]/.test(ch)) escape = false;
        } else if (ch === '\u001b') {
          escape = true;
        } else if (ch === '\r' || ch === '\n') {
          return done(value);
        } else if (ch === '\u0003' || (ch === '\u0004' && !value)) {
          return done(null);
        } else if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else if (ch >= ' ') {
          value += ch;
        }
      }
    }
    output.write(prompt);
    setRaw.call(input, true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
}

export function terminalIO(p: Pick<NodeJS.Process, 'stdin' | 'stdout' | 'stderr'> = process): CliIO {
  return {
    out: (t) => void p.stdout.write(`${t}\n`),
    err: (t) => void p.stderr.write(`${t}\n`),
    ask: (prompt) => askLine(p.stdin, p.stderr, prompt),
    askSecret: (prompt) => askSecret(p.stdin, p.stderr, prompt),
    interactive: p.stdin.isTTY === true,
  };
}

/**
 * What the person can type to run this file again, for help and messages:
 * the path as seen from the current folder (or the full path when it is
 * elsewhere), in quotes when it has spaces or brackets, as a browser's
 * "lewis-alt-text (1).mjs" does.
 */
export function programName(script: string, o: { cwd: string; viaNode: boolean }): string {
  const rel = path.relative(o.cwd, script);
  const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : script;
  const quoted = /^[\w@%+=:,./\\-]+$/.test(shown) ? shown : `"${shown}"`;
  if (o.viaNode) return `node ${quoted}`;
  return /[/\\]/.test(shown) ? quoted : `./${quoted}`;
}

// --- Your Claude subscription, through the local claude CLI ----------------

/** Short names the claude CLI accepts for the app's model ids. */
const ALIASES: Record<string, string> = { 'claude-opus-5-5': 'opus', 'claude-sonnet-5-5': 'sonnet', 'claude-haiku-5-5': 'haiku' };

function safeJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Settings that would make Claude Code bill an API key or a cloud account instead of the subscription. */
const NOT_SUBSCRIPTION = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

/** This process's environment without NOT_SUBSCRIPTION, for the claude child. */
export function subscriptionEnv(env: Env = process.env): Env {
  const out = { ...env };
  for (const k of NOT_SUBSCRIPTION) delete out[k];
  return out;
}

/**
 * One model request through the local `claude` CLI (headless), on the
 * signed-in Claude subscription: no API key, no per-token bill. Claude Code
 * gets an environment without API keys, and if its startup message still
 * names an API key as its credential (set up in its own settings), the run
 * is stopped there and nothing is sent.
 */
export function generateWithClaude(req: ModelRequest, o: { bin?: string; timeoutMs?: number; env?: Env } = {}): Promise<ModelReply> {
  const bin = o.bin || 'claude';
  const timeoutMs = o.timeoutMs ?? 180_000;
  // The system prompt is ~35 kB: pass it as a file. Run in a temp dir so no project CLAUDE.md is read.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lewis-alt-'));
  const promptFile = path.join(dir, 'system.md');
  writeFileSync(promptFile, req.system.map((b) => b.text).join('\n\n'));
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '',
    '--no-session-persistence', '--system-prompt-file', promptFile, '--model', ALIASES[req.model] ?? req.model];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: subscriptionEnv(o.env) });
    let out = '';
    let err = '';
    let checked = false;
    let refused: ModeUnavailable | null = null;
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      fn();
    };
    child.stdout.on('data', (d: Buffer) => {
      out += d;
      if (checked || !out.includes('\n')) return;
      checked = true;
      const init = safeJson(out.slice(0, out.indexOf('\n')));
      const source = init?.type === 'system' ? init.apiKeySource : undefined;
      if (typeof source === 'string' && source !== 'none') {
        refused = new ModeUnavailable(
          `Claude Code on this computer is set up to use an API key (${source}), not your Claude subscription, so this stopped before sending anything. ` +
            `Sign Claude Code in with your subscription (run "${bin}", then /login), or use --use-own-key.`,
        );
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.stdin.on('error', () => {}); // a claude that exits at once closes stdin under us; 'close' reports it
    child.on('error', (e: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          e.code === 'ENOENT' || e.code === 'EINVAL'
            ? new ModeUnavailable(
                `--use-local-subscription needs Claude Code (the "${bin}" command), and this computer does not have it. ` +
                  'Install it from https://claude.com/claude-code and sign in, or pay another way (see --help).',
              )
            : e,
        ),
      ),
    );
    child.on('close', (code, signal) => {
      if (refused) return finish(() => reject(refused));
      if (signal) return finish(() => reject(new Error(`Claude Code stopped (${signal}) after ${timeoutMs / 1000} s`)));
      const result = out.split('\n').filter(Boolean).map(safeJson).find((e) => e?.type === 'result');
      if (!result) return finish(() => reject(new Error(`Claude Code exited ${code} without a result. ${err.trim().slice(-500)}`)));
      if (result.is_error || result.subtype !== 'success') {
        const why = String(result.result || result.subtype);
        // Signed out of Claude Code: every image would fail the same way.
        const E = /log ?in|api key|auth|credential/i.test(why) ? ModeUnavailable : Error;
        const hint = E === ModeUnavailable ? ` Run "${bin}" on its own once to sign in.` : '';
        return finish(() => reject(new E(`Claude Code: ${why}${hint}`)));
      }
      finish(() =>
        resolve({
          text: String(result.result ?? ''),
          model: Object.keys((result.modelUsage as object | undefined) ?? {})[0],
          usage: result.usage as ModelReply['usage'],
          stopReason: typeof result.stop_reason === 'string' ? result.stop_reason : null,
        }),
      );
    });
    child.stdin.end(JSON.stringify({ type: 'user', message: req.messages[0] }) + '\n');
  });
}

// --- Your own Anthropic API key --------------------------------------------

/** Models that take the API's server-side refusal fallback in its "default" form (Haiku has none). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

/** The API's own words from an error body, or the SDK's message. */
function apiMessage(e: Error & { error?: unknown }): string {
  const body = e.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === 'string' ? body.error.message : e.message;
}

/**
 * Model calls to api.anthropic.com with the person's own key, through the
 * Anthropic SDK (loaded only for --use-own-key, so a clone without npm
 * install runs everything else). On Opus and Sonnet a declined request is
 * retried by the API on its fallback model, billed to the same key. Errors
 * that would repeat for every image (a refused key, a rate limit, no
 * network) are ModeUnavailable, so the run stops.
 */
export async function ownKeyGenerate(apiKey: string, o: { fetch?: typeof fetch; maxRetries?: number; baseURL?: string } = {}): Promise<Generate> {
  let A: typeof Anthropic;
  try {
    A = (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw new ModeUnavailable('--use-own-key needs the Anthropic SDK: run npm install in lewis-alt-text/ (or use the downloaded single file, which includes it).');
  }
  // Only the person's key: never an ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile from this computer.
  const client = new A({ apiKey, authToken: null, fetch: o.fetch, maxRetries: o.maxRetries, baseURL: o.baseURL });
  return async (req) => {
    let m: Anthropic.Beta.BetaMessage;
    try {
      m = await client.beta.messages.create({
        model: req.model,
        max_tokens: req.max_tokens,
        system: req.system,
        messages: req.messages,
        ...(FALLBACK_MODELS.has(req.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
    } catch (e) {
      if (e instanceof A.AuthenticationError) {
        throw new ModeUnavailable('Anthropic did not accept this API key. Check it, or create a new one, at https://console.anthropic.com/settings/keys.');
      }
      if (e instanceof A.PermissionDeniedError) throw new ModeUnavailable(`This API key may not do that: ${apiMessage(e)}`);
      if (e instanceof A.RateLimitError) throw new ModeUnavailable('Anthropic is limiting how fast this key can be used. Wait a minute, then run the same command again.');
      if (e instanceof A.APIConnectionError) throw new ModeUnavailable(`Could not reach api.anthropic.com: ${networkReason(e.cause ?? e)}. Check the internet connection.`);
      if (e instanceof A.APIError) throw new Error(`Anthropic: ${apiMessage(e)}`);
      throw e;
    }
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, model: m.model, stopReason: m.stop_reason, usage: m.usage };
  };
}

// --- Image conversion on macOS ---------------------------------------------

export type Run = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>;

/** Runs a program; never throws (a missing program is code 127). */
export const runFile: Run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (e, stdout) => {
      const code = e ? (typeof e.code === 'number' ? e.code : 127) : 0;
      resolve({ code, stdout: String(stdout ?? '') });
    });
  });

const STEPS: Array<{ edge: number; format: 'png' | 'jpeg'; quality?: number }> = [
  { edge: MAX_EDGE, format: 'png' },
  { edge: MAX_EDGE, format: 'jpeg', quality: 85 },
  { edge: 1200, format: 'jpeg', quality: 75 },
  { edge: 1000, format: 'jpeg', quality: 60 },
];

/**
 * Converts and shrinks images with sips, which every Mac has: HEIC, TIFF or
 * BMP become PNG, and an image over the limit is redrawn smaller, as PNG
 * (best for line drawings) or, if that is still too big, as JPEG, as the web
 * app does. Never enlarges.
 */
export function sipsFit(run: Run = runFile, tmp: string = os.tmpdir()): FitImage {
  return async (bytes, limit) => {
    const dir = mkdtempSync(path.join(tmp, 'lewis-img-'));
    try {
      const src = path.join(dir, 'image');
      writeFileSync(src, bytes);
      const info = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', src]);
      const width = Number(info.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
      const height = Number(info.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
      if (info.code !== 0 || !width || !height) return null;
      const from = sniffType(bytes) ? null : (info.stdout.match(/format:\s*(\S+)/)?.[1] ?? 'its format');
      const long = Math.max(width, height);
      for (const step of STEPS) {
        const out = path.join(dir, step.format === 'png' ? 'out.png' : 'out.jpg');
        const args = ['-s', 'format', step.format];
        if (step.quality) args.push('-s', 'formatOptions', String(step.quality));
        if (long > step.edge) args.push('-Z', String(step.edge));
        if ((await run('sips', [...args, src, '--out', out])).code !== 0 || !existsSync(out)) return null;
        const b = new Uint8Array(readFileSync(out));
        if (b.length > limit || !sniffType(b)) continue;
        const scale = Math.min(1, step.edge / long);
        const size = `${Math.round(width * scale)} x ${Math.round(height * scale)} pixels`;
        const what = `${step.format.toUpperCase()}, ${size}, ${Math.round(b.length / 1000)} kB`;
        return { bytes: b, note: from ? `converted from ${from} (${what})` : `made smaller to fit the size limit (${what})` };
      }
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
