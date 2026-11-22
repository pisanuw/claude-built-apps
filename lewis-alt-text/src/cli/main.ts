/**
 * The command-line tool, written for someone who has just downloaded it:
 * every mistake a newcomer is likely to make gets a message that says what
 * to do next. Node's file system is used directly; the network, the
 * terminal, the session file, the claude CLI and image conversion come in
 * through CliDeps, so the tests run every path with fakes.
 *
 * src/cli/run.ts wires the real ones for both ways of running it: from a
 * clone (cli/lewis-alt-text) and as the downloadable single file
 * (src/cli/bundle.ts, built by scripts/build-cli.mjs).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_MODEL, writeAltText, type Generate, type Result } from '../core/alt-text.ts';
import { formatReset } from '../core/caps.ts';
import { MAX_SEND_BYTES } from '../core/image.ts';
import { APP_URL, CapReachedError, createRemote, INSTRUCTIONS_URL, SignedOut, TERMINAL_URL, type SessionStore } from '../core/remote.ts';
import { FOCUSES, InputError, normaliseOptions, PURPOSES, sniffType, toBase64, type MediaType } from '../core/request.ts';

/**
 * The API's per-image limit is 5 MB. It is safe to count that against the
 * base64 the request carries, so the image itself stays under 3/4 of it.
 * Applies when the request goes to Anthropic directly: --use-local-subscription and --use-own-key.
 */
export const API_MAX_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);
export const MODELS: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
export const COMMANDS = ['login', 'status', 'logout'] as const;
/** Which way the model runs, and so who pays: the HintWise allowance, your Claude subscription, or your own API key. */
export type Mode = 'hintwise' | 'subscription' | 'own-key';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
/** Formats only an image converter (macOS sips) can read. */
const CONVERTIBLE_EXT = /\.(heic|heif|tiff?|bmp)$/i;

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  /** One line typed (or pasted) by the person; null when the input has ended. */
  ask(prompt: string): Promise<string | null>;
  /** Like ask, without showing what is typed (for an API key). */
  askSecret(prompt: string): Promise<string | null>;
  /** True when a person is at the keyboard (stdin is a terminal). */
  interactive: boolean;
}

/** Makes an image the API takes, within `limit` bytes; null when it cannot. */
export type FitImage = (bytes: Uint8Array, limit: number) => Promise<{ bytes: Uint8Array; note: string } | null>;

export interface HintwiseConfig {
  supabaseUrl: string;
  anonKey: string;
}

export interface CliDeps {
  argv: string[];
  /** What the person typed to start the tool, shown in help and messages. */
  program: string;
  version: string;
  io: CliIO;
  skill: () => Promise<string>;
  config: () => HintwiseConfig;
  store: SessionStore & { file: string };
  /** Claude Code on this computer, on the person's Claude subscription: --use-local-subscription. */
  subscription: Generate;
  /** Calls to api.anthropic.com with the person's own key: --use-own-key. */
  ownKey: (apiKey: string) => Promise<Generate>;
  fetch?: typeof fetch;
  /** Image conversion and shrinking, where the computer has a tool for it. */
  fit?: FitImage;
  env?: Record<string, string | undefined>;
  homedir?: string;
  platform?: string;
}

/** The chosen way of running the model cannot work right now (no Claude Code, a refused key, ...): the other images would fail the same way. */
export class ModeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModeUnavailable';
  }
}

/** The first line of every run that writes alt text: who pays for it. */
export function usingLine(mode: Mode, detail: string | null): string {
  if (mode === 'subscription') {
    return "Using: your Claude subscription, through Claude Code on this computer. No per-image charge; it counts toward your plan's usage limits.";
  }
  if (mode === 'own-key') return `Using: your own Anthropic API key${detail ? ` (${detail})` : ''}. Anthropic bills this key for each image.`;
  return `Using: the free HintWise allowance${detail ? ` (signed in as ${detail})` : ''}. To pay another way, see --help.`;
}

/** An Anthropic API key, or an error that says what one looks like. */
export function checkKey(key: string): string {
  const k = key.trim();
  if (!/^sk-ant-\S{8,}$/.test(k)) {
    throw new InputError('That does not look like an Anthropic API key; those start with sk-ant-. Create one at https://console.anthropic.com/settings/keys.');
  }
  return k;
}

/** The live app's public sign-in values from deploy/target.yml, so there is one copy. Public by design: the anon key only reaches what row level security allows. */
export function hintwiseConfig(targetYml: string, env: Record<string, string | undefined> = {}): HintwiseConfig {
  const get = (key: string) => targetYml.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
  const supabaseUrl = env.LEWIS_SUPABASE_URL || get('VITE_SUPABASE_URL');
  const anonKey = env.LEWIS_SUPABASE_ANON_KEY || get('VITE_SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) throw new Error('could not read the HintWise sign-in settings');
  return { supabaseUrl, anonKey };
}

const choices = (table: object) => Object.keys(table).filter((k) => k !== 'unknown');

export function helpText(program: string): string {
  return `Lewis Structure Alt Text: alt text for screen reader users, for images of
Lewis structures and related chemistry figures.

Commands:
  login           sign this computer in to HintWise (once per computer)
  status          who is signed in, and how many alt texts are left
  logout          sign this computer out
  IMAGE...        write alt text for each image: PNG, JPEG, GIF or WebP
                  files, or folders of them

Options for images:
  -p, --purpose P   ${choices(PURPOSES).join(' | ')}   (default: treated as a question)
  -f, --focus F     ${choices(FOCUSES).join(' | ')}
  -c, --context T   caption, question text or lesson topic, in quotes
  -a, --audit       also show the atom-by-atom count the alt text is built from
  -m, --model M     opus (default), sonnet or haiku
  -j, --json        print one JSON object per image, for scripts
  -h, --help        show this help
  -v, --version     show which version this is

Who pays for the model (choose at most one; it says which on every run):
  (neither)                  the free HintWise allowance; sign in once with login
  --use-local-subscription   your Claude subscription, through Claude Code on this
                             computer: no per-image charge, counts toward its limits
  --use-own-key              your own Anthropic API key, from ANTHROPIC_API_KEY or
                             typed in when asked: Anthropic bills it for each image

Examples:
  ${program} login
  ${program} figure.png
  ${program} figure.png --purpose question --focus geometry --context "HW 3, question 2"
  ${program} my-figures
  ${program} my-figures --use-own-key

The alt text is printed on standard output; notes, warnings and errors on standard error.
Exit status: 0 alt text written, 2 the model asked a question, 1 error.
Instructions: ${INSTRUCTIONS_URL}`;
}

const OPTIONS = {
  purpose: { type: 'string', short: 'p' },
  focus: { type: 'string', short: 'f' },
  context: { type: 'string', short: 'c' },
  audit: { type: 'boolean', short: 'a' },
  model: { type: 'string', short: 'm' },
  'use-local-subscription': { type: 'boolean' },
  'use-own-key': { type: 'boolean' },
  // The old name of --use-local-subscription; still accepted, not in the help.
  local: { type: 'boolean', short: 'l' },
  json: { type: 'boolean', short: 'j' },
  code: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

const PURPOSE_ALIASES: Record<string, string> = { answer: 'answer-key', answerkey: 'answer-key', key: 'answer-key', q: 'question' };
const FOCUS_ALIASES: Record<string, string> = { formal: 'formal-charge', formalcharge: 'formal-charge', charge: 'formal-charge', 'formal-charges': 'formal-charge', shape: 'geometry' };

/** One of a table's keys, forgiving case, spaces and underscores. */
export function choice(value: string | undefined, table: object, flag: string, aliases: Record<string, string> = {}): string {
  if (value === undefined) return 'unknown';
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const key = aliases[v] ?? v;
  if (key in table) return key;
  throw new InputError(`${flag} must be one of: ${choices(table).join(', ')} (you gave "${value}").`);
}

/** A model id from opus, sonnet or haiku (or a full claude-... id). */
export function resolveModel(value: string | undefined): string {
  if (!value) return DEFAULT_MODEL;
  const v = value.trim().toLowerCase();
  if (MODELS[v]) return MODELS[v];
  if (/^claude-[a-z0-9.-]+$/.test(v)) return v;
  throw new InputError(`--model must be opus, sonnet or haiku (you gave "${value}").`);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const kB = (n: number) => `${Math.round(n / 1000).toLocaleString('en-US')} kB`;

/** A file system error in words, with what to do about it. */
export function fsMessage(e: unknown, platform: string = process.platform): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'no such file';
  if (code === 'EISDIR') return 'that is a folder, not a file';
  if (code === 'EPERM' && platform === 'darwin') {
    return 'macOS did not let this terminal read it. Allow it in System Settings > Privacy & Security > Files and Folders, or move the image to another folder.';
  }
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied: this account cannot read it';
  return errorMessage(e);
}

export interface Input {
  file: string;
  /** Why this argument gives no image; shown in its place, in order. */
  error?: string;
}

type Kind = 'file' | 'dir' | 'missing' | 'other' | { error: string };

async function kindOf(p: string): Promise<Kind> {
  try {
    const s = await stat(p);
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other';
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : { error: fsMessage(e) };
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function wildcard(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

/**
 * The image files the arguments name: files as they are, folders as the
 * images in them, and wildcards like *.png that the shell left alone (the
 * Windows shells do). An argument that names nothing becomes an error entry.
 */
export async function expandInputs(args: string[], o: { homedir?: string; convertible?: boolean } = {}): Promise<Input[]> {
  const wanted = (name: string) => !name.startsWith('.') && (IMAGE_EXT.test(name) || (o.convertible === true && CONVERTIBLE_EXT.test(name)));
  const out: Input[] = [];
  for (const arg of args) {
    const p = o.homedir && /^~(?=$|[/\\])/.test(arg) ? o.homedir + arg.slice(1) : arg;
    const kind = await kindOf(p);
    if (kind === 'file') {
      out.push({ file: p });
    } else if (kind === 'dir') {
      let names: string[] = [];
      try {
        names = (await readdir(p)).filter(wanted).sort(byName);
      } catch (e) {
        out.push({ file: p, error: fsMessage(e) });
        continue;
      }
      if (!names.length) out.push({ file: p, error: 'no images in this folder (it looks for .png, .jpg, .gif and .webp files)' });
      for (const n of names) out.push({ file: path.join(p, n) });
    } else if (kind === 'missing' && /[*?]/.test(path.basename(p)) && !/[*?]/.test(path.dirname(p))) {
      const dir = path.dirname(p);
      const re = wildcard(path.basename(p));
      let names: string[] = [];
      try {
        names = (await readdir(dir)).filter((n) => re.test(n) && wanted(n)).sort(byName);
      } catch (e) {
        out.push({ file: p, error: fsMessage(e) });
        continue;
      }
      if (!names.length) out.push({ file: p, error: 'no images match this' });
      for (const n of names) out.push({ file: path.join(dir, n) });
    } else if (kind === 'missing' && /^https?:\/\//i.test(arg)) {
      out.push({ file: p, error: 'that is a web address. Save the image to this computer first, then give its file name.' });
    } else if (kind === 'missing') {
      const word = /^[a-z][a-z-]*$/i.test(arg);
      out.push({ file: p, error: word ? `no such file, and not a command (the commands are ${COMMANDS.join(', ')})` : 'no such file' });
    } else if (kind === 'other') {
      out.push({ file: p, error: 'not a file' });
    } else {
      out.push({ file: p, error: kind.error });
    }
  }
  return out;
}

export interface LoadedImage {
  base64: string;
  mediaType: MediaType;
  note?: string;
}

/** Reads an image and makes sure the model can take it: a supported type, within `limit` bytes. */
export async function loadImage(file: string, o: { limit: number; mode: Mode; fit?: FitImage; platform?: string }): Promise<LoadedImage> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (e) {
    throw new InputError(fsMessage(e, o.platform));
  }
  if (bytes.length === 0) throw new InputError('the file is empty');
  let type = sniffType(bytes);
  let note: string | undefined;
  if ((!type || bytes.length > o.limit) && o.fit) {
    const fitted = await o.fit(bytes, o.limit);
    if (fitted) {
      bytes = fitted.bytes;
      type = sniffType(bytes);
      note = fitted.note;
    }
  }
  if (!type) throw new InputError('not a PNG, JPEG, GIF or WebP image. Save or export it as PNG and try again.');
  if (bytes.length > o.limit) {
    throw new InputError(
      o.mode === 'hintwise'
        ? `the image is ${kB(bytes.length)}, and the live app takes up to ${kB(o.limit)}. Crop it or save it smaller, ` +
            `or drop it into the web app (${APP_URL}), which shrinks images for you.`
        : `the image is ${kB(bytes.length)}, and Anthropic takes up to ${kB(o.limit)}. Crop it or save it smaller.`,
    );
  }
  return { base64: toBase64(bytes), mediaType: type, note };
}

type Outcome = Result | { kind: 'error'; message: string; warnings: string[] };

export async function main(d: CliDeps): Promise<number> {
  const { io, program } = d;
  let parsed;
  try {
    parsed = parseArgs({ args: d.argv, allowPositionals: true, options: OPTIONS });
  } catch (e) {
    // Node's own text goes on about positional arguments; the first sentence is the useful part.
    io.err(`${errorMessage(e).split('. To specify')[0]}\nTo see the options, run: ${program} --help`);
    return 1;
  }
  const { values: o, positionals } = parsed;
  if (o.version) {
    io.out(`lewis-alt-text ${d.version}`);
    return 0;
  }
  if (o.help || positionals.length === 0) {
    io.out(helpText(program));
    return o.help ? 0 : 1;
  }

  let remote: ReturnType<typeof createRemote> | undefined;
  const getRemote = () => (remote ??= createRemote({ ...d.config(), store: d.store, fetch: d.fetch, loginCommand: `${program} login` }));

  async function login(given: string | undefined, standalone: boolean): Promise<number> {
    let code = given;
    if (code === undefined) {
      io.err(
        [
          'Sign this computer in to HintWise (you only do this once):',
          `  1. Open ${TERMINAL_URL} in your web browser.`,
          '  2. Enter your email address there, then open the link HintWise emails you.',
          '  3. The page shows a code. Copy it, paste it here and press Enter.',
          '     (Pasting the whole link from the email works too.)',
          '',
        ].join('\n'),
      );
    }
    for (let attempt = 1; ; attempt++) {
      if (code === undefined) {
        const line = await io.ask('Code: ');
        if (line === null) {
          io.err('No code was entered, so this computer is not signed in.');
          return 1;
        }
        code = line;
      }
      try {
        const s = await getRemote().verify(code);
        io.err(`Signed in${s.email ? ` as ${s.email}` : ''}. The sign-in is saved in ${d.store.file}, which only you can read.`);
        if (standalone) io.err(`Next, write alt text: ${program} figure.png`);
        return 0;
      } catch (e) {
        if (!(e instanceof InputError) || given !== undefined || !io.interactive || attempt >= 3) throw e;
        io.err(`${e.message} Try again, or press Ctrl+C to stop.`);
        code = undefined;
      }
    }
  }

  async function logout(): Promise<number> {
    const had = await getRemote().logout();
    io.err(had ? 'Signed out; the saved sign-in is removed from this computer.' : 'This computer was not signed in.');
    return 0;
  }

  async function status(): Promise<number> {
    const s = await d.store.load();
    if (!s) {
      io.out(`Not signed in. To sign in, run: ${program} login`);
      return 1;
    }
    const a = await getRemote().check();
    const who = s.email ? `Signed in as ${s.email}.` : 'Signed in.';
    if (!a.allowed) {
      io.out(`${who} ${a.scope ? new CapReachedError(a.scope, a.resetsAt).message : 'The HintWise key is not available right now.'}`);
    } else if (a.callsLeft !== null) {
      const when = a.resetsAt ? `; more at ${formatReset(a.resetsAt)}` : '';
      io.out(`${who} ${a.callsLeft} alt text${a.callsLeft === 1 ? '' : 's'} left${when}.`);
    } else {
      io.out(`${who} The HintWise key is available.`);
    }
    return 0;
  }

  async function altTexts(args: string[]): Promise<number> {
    // Option mistakes first, before signing in or reading any image.
    const options = {
      purpose: choice(o.purpose, PURPOSES, '--purpose', PURPOSE_ALIASES),
      focus: choice(o.focus, FOCUSES, '--focus', FOCUS_ALIASES),
      context: o.context ?? '',
      audit: o.audit === true,
    };
    normaliseOptions(options);
    const model = resolveModel(o.model ?? d.env?.LEWIS_MODEL);
    if (o.local) io.err('note: --local is now called --use-local-subscription.');
    const subscription = o['use-local-subscription'] === true || o.local === true;
    if (subscription && o['use-own-key']) throw new InputError('Choose one: --use-local-subscription or --use-own-key.');
    const mode: Mode = o['use-own-key'] ? 'own-key' : subscription ? 'subscription' : 'hintwise';
    const inputs = await expandInputs(args, { homedir: d.homedir, convertible: d.fit !== undefined });
    if (o.context !== undefined && inputs.some((i) => i.error?.startsWith('no such file'))) {
      io.err('hint: if those words were meant for --context, put the whole context in quotes, as in --context "HW 3, question 2".');
    }

    // Sign in, or get the key, only when there is an image to send; otherwise the file errors are the news.
    let generate: Generate | null = null;
    if (inputs.some((i) => !i.error)) {
      if (mode === 'hintwise') {
        let email: string | null;
        try {
          email = (await getRemote().session()).email;
        } catch (e) {
          if (!(e instanceof SignedOut)) throw e;
          if (!io.interactive) {
            io.err(`${e.message}\nOr pay another way: --use-local-subscription (Claude Code) or --use-own-key (your Anthropic API key).`);
            return 1;
          }
          io.err('This computer is not signed in to HintWise yet, so that comes first.\n');
          const signedIn = await login(undefined, false);
          if (signedIn !== 0) return signedIn;
          io.err('');
          email = (await d.store.load())?.email ?? null;
        }
        io.err(usingLine(mode, email));
        generate = getRemote().generate;
      } else if (mode === 'subscription') {
        io.err(usingLine(mode, null));
        generate = d.subscription;
      } else {
        const key = await ownKey();
        if (!key) return 1;
        io.err(usingLine(mode, `ending ${key.slice(-4)}${d.env?.ANTHROPIC_API_KEY?.trim() ? ', from ANTHROPIC_API_KEY' : ''}`));
        generate = await d.ownKey(key);
      }
    }

    const skill = await d.skill();
    const limit = mode === 'hintwise' ? MAX_SEND_BYTES : API_MAX_BYTES;
    const billed = { calls: 0, input: 0, cached: 0, output: 0 };
    let hadError = false;
    let hadQuestion = false;
    for (const [i, input] of inputs.entries()) {
      let r: Outcome;
      let stop = false;
      try {
        if (input.error || !generate) throw new InputError(input.error ?? 'no image');
        const img = await loadImage(input.file, { limit, mode, fit: d.fit, platform: d.platform });
        if (img.note) io.err(`note: ${input.file}: ${img.note}`);
        const res = await writeAltText({ base64: img.base64, mediaType: img.mediaType, options, skill, model, generate });
        r = res;
        if (res.usage) {
          billed.calls++;
          billed.input += (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
          billed.cached += res.usage.cache_read_input_tokens ?? 0;
          billed.output += res.usage.output_tokens ?? 0;
        }
      } catch (e) {
        // Signed out, out of allowance, no Claude Code, a refused key: the other images would fail the same way.
        stop = e instanceof SignedOut || e instanceof CapReachedError || e instanceof ModeUnavailable;
        const extra = e instanceof CapReachedError ? ' Or pay another way: --use-local-subscription or --use-own-key.' : '';
        r = { kind: 'error', message: errorMessage(e) + extra, warnings: [] };
      }
      if (o.json) {
        io.out(JSON.stringify({ file: input.file, ...r }));
      } else {
        if (inputs.length > 1) io.out(`== ${input.file} ==`);
        if (r.kind === 'alt') {
          if (r.audit) io.err(`--- audit ---\n${r.audit}\n-------------`);
          io.out(r.altText);
          for (const w of r.warnings) io.err(`warning: ${w}`);
        } else if (r.kind === 'question') {
          io.out(`QUESTION: ${r.question}`);
          io.err('Answer it with --context "..." and run the same command again.');
        } else {
          io.err(`error: ${input.file}: ${r.message}`);
        }
      }
      hadError ||= r.kind === 'error';
      hadQuestion ||= r.kind === 'question';
      if (stop) {
        const left = inputs.length - i - 1;
        if (left > 0) io.err(`Stopped; ${left} more image${left === 1 ? ' was' : 's were'} not done.`);
        break;
      }
    }
    if (mode === 'own-key' && billed.calls) {
      const n = (x: number) => x.toLocaleString('en-US');
      io.err(
        `Billed to your key: ${billed.calls} request${billed.calls === 1 ? '' : 's'}, ${n(billed.input)} input tokens ` +
          `(${n(billed.cached)} of them read from the cache, which costs less), ${n(billed.output)} output tokens.`,
      );
    }
    // An error outranks a question.
    return hadError ? 1 : hadQuestion ? 2 : 0;
  }

  /** The person's API key: from ANTHROPIC_API_KEY, or typed in (not shown, not saved). Null when none was given. */
  async function ownKey(): Promise<string | null> {
    const fromEnv = d.env?.ANTHROPIC_API_KEY?.trim();
    if (fromEnv) return checkKey(fromEnv);
    if (!io.interactive) {
      throw new InputError('--use-own-key needs your Anthropic API key in the ANTHROPIC_API_KEY environment variable.');
    }
    const typed = await io.askSecret('Your Anthropic API key (starts with sk-ant-; not shown, not saved): ');
    if (!typed?.trim()) {
      io.err('No key was entered.');
      return null;
    }
    return checkKey(typed);
  }

  try {
    const first = positionals[0].toLowerCase();
    const command = (COMMANDS as readonly string[]).includes(first) && (await kindOf(positionals[0])) === 'missing' ? first : null;
    if (command === 'login') return await login(positionals[1] ?? o.code, true);
    if (command === 'logout') return await logout();
    if (command === 'status') return await status();
    return await altTexts(positionals);
  } catch (e) {
    io.err(`error: ${errorMessage(e)}`);
    return 1;
  }
}
