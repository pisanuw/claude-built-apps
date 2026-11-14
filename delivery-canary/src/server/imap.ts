/**
 * A small IMAP client: just enough of RFC 3501 (plus Gmail's X-GM-EXT-1) to
 * sign in to a seed mailbox, find one message and read it. Commands are sent
 * one at a time and their responses parsed into tokens, with literals
 * ({n} followed by n bytes) kept as raw bytes.
 *
 * It talks to any Duplex stream, so the tests drive it with a scripted fake
 * server, and the live function hands it a TLS socket to imap.gmail.com.
 */
import type { Duplex } from 'node:stream';

/** One parsed value: an atom or number (string), a quoted string, a literal (bytes), a parenthesised list, or NIL (null). */
export type Token = string | Quoted | Buffer | Token[] | null;

/** A quoted string, kept apart from atoms so "NIL" in quotes is not NIL. */
export class Quoted {
  constructor(readonly value: string) {}
}

export interface StatusResponse {
  status: 'OK' | 'NO' | 'BAD';
  /** The response code inside [...] at the start of the text, without the brackets ('' when none). */
  code: string;
  text: string;
}

export interface CommandResult extends StatusResponse {
  /** Untagged data responses ("* ..."), each as its token list (without the "*"). */
  untagged: Token[][];
}

export class ImapError extends Error {
  constructor(
    message: string,
    readonly kind: 'closed' | 'timeout' | 'protocol' | 'no' | 'bad',
    readonly response?: StatusResponse,
  ) {
    super(message);
  }
}

/** The text form of an atom, a quoted string or a literal; '' for anything else. */
export function str(t: Token | undefined): string {
  if (typeof t === 'string') return t;
  if (t instanceof Quoted) return t.value;
  if (Buffer.isBuffer(t)) return t.toString('utf8');
  return '';
}

/** A quoted string for a command, escaping \ and ". Refuses CR, LF and NUL, which a quoted string cannot carry. */
export function quote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new ImapError('A value with a line break cannot be sent.', 'protocol');
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export function parseStatus(rest: string): StatusResponse {
  const m = /^(OK|NO|BAD)\b ?(.*)$/is.exec(rest);
  if (!m) throw new ImapError(`Unexpected response: ${rest.slice(0, 80)}`, 'protocol');
  const status = m[1].toUpperCase() as StatusResponse['status'];
  const text = m[2];
  const code = /^\[([^\]]*)\]\s*/.exec(text);
  return { status, code: code ? code[1] : '', text: code ? text.slice(code[0].length) : text };
}

/**
 * One whole response: the text of each line piece, and the literal that
 * follows each piece but the last. A response ends at a CRLF that is not the
 * end of a literal marker.
 */
export interface RawResponse {
  parts: string[];
  literals: Buffer[];
}

/** Splits a byte stream into whole responses. */
export class ResponseSplitter {
  private buf: Buffer = Buffer.alloc(0);
  private parts: string[] = [];
  private literals: Buffer[] = [];
  private need = -1;

  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}

  push(chunk: Buffer): RawResponse[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.buf.length > this.maxBytes) throw new ImapError('The mail server sent more than this check reads.', 'protocol');
    const out: RawResponse[] = [];
    for (;;) {
      if (this.need >= 0) {
        if (this.buf.length < this.need) break;
        this.literals.push(Buffer.from(this.buf.subarray(0, this.need)));
        this.buf = this.buf.subarray(this.need);
        this.need = -1;
        continue;
      }
      const end = this.buf.indexOf('\r\n');
      if (end < 0) break;
      const line = this.buf.subarray(0, end).toString('latin1');
      this.buf = this.buf.subarray(end + 2);
      this.parts.push(line);
      const lit = /\{(\d{1,9})\+?\}$/.exec(line);
      if (lit) {
        this.need = Number(lit[1]);
        if (this.need > this.maxBytes) throw new ImapError('The mail server sent more than this check reads.', 'protocol');
        continue;
      }
      out.push({ parts: this.parts, literals: this.literals });
      this.parts = [];
      this.literals = [];
    }
    return out;
  }
}

const ATOM_END = new Set([' ', '(', ')', '"', '{', '\r', '\n']);

/** Parses the tokens of a response (all of it, including the leading "*" or tag). */
export function tokenize(raw: RawResponse): Token[] {
  const root: Token[] = [];
  const stack: Token[][] = [root];
  let part = 0;
  let text = raw.parts[0] ?? '';
  let i = 0;
  const top = () => stack[stack.length - 1];
  for (;;) {
    if (i >= text.length) break;
    const c = text[i];
    if (c === ' ') {
      i++;
    } else if (c === '(') {
      const list: Token[] = [];
      top().push(list);
      stack.push(list);
      i++;
    } else if (c === ')') {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) i++;
        s += text[i++];
      }
      i++;
      top().push(new Quoted(Buffer.from(s, 'latin1').toString('utf8')));
    } else if (c === '{' && /^\{\d+\+?\}$/.test(text.slice(i))) {
      top().push(raw.literals[part] ?? Buffer.alloc(0));
      part++;
      text = raw.parts[part] ?? '';
      i = 0;
    } else {
      // An atom; [...] inside it (BODY[]<0>, [Gmail]) may hold spaces.
      let s = '';
      let depth = 0;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && ATOM_END.has(ch)) break;
        s += ch;
        i++;
      }
      top().push(s.toUpperCase() === 'NIL' ? null : s);
    }
  }
  return root;
}

export interface ImapOptions {
  /** Absolute time (ms since epoch) after which every wait fails. */
  deadline: number;
  now?: () => number;
}

/** One IMAP session over a connected stream. */
export class ImapClient {
  private readonly splitter = new ResponseSplitter();
  private queue: RawResponse[] = [];
  private waiter: (() => void) | null = null;
  private closed: Error | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(
    private readonly socket: Duplex,
    private readonly opts: ImapOptions,
  ) {
    this.now = opts.now ?? Date.now;
    socket.on('data', (chunk: Buffer) => {
      try {
        this.queue.push(...this.splitter.push(chunk));
      } catch (e) {
        this.closed = e as Error;
        socket.destroy();
      }
      this.wake();
    });
    const end = (e?: Error) => {
      this.closed ??= e ?? new ImapError('The mail server closed the connection.', 'closed');
      this.wake();
    };
    socket.on('error', (e: Error) => end(new ImapError(`Connection error: ${e.message}`, 'closed')));
    socket.on('close', () => end());
    socket.on('end', () => end());
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  private async next(): Promise<RawResponse> {
    for (;;) {
      const r = this.queue.shift();
      if (r) return r;
      if (this.closed) throw this.closed;
      const left = this.opts.deadline - this.now();
      if (left <= 0) throw new ImapError('The mail server took too long to answer.', 'timeout');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          this.waiter = null;
          resolve();
        }, left);
        this.waiter = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  }

  /** Waits for the server's greeting; refuses a BYE or PREAUTH greeting. */
  async greeting(): Promise<void> {
    const r = await this.next();
    const line = r.parts[0] ?? '';
    if (!/^\* OK\b/i.test(line)) throw new ImapError(`The mail server refused the connection: ${line.slice(0, 120)}`, 'protocol');
  }

  /** Sends one command and collects its untagged responses until the tagged answer. NO and BAD throw. */
  async command(cmd: string): Promise<CommandResult> {
    if (this.closed) throw this.closed;
    const tag = `D${++this.seq}`;
    this.socket.write(`${tag} ${cmd}\r\n`);
    const untagged: Token[][] = [];
    for (;;) {
      const r = await this.next();
      const first = r.parts[0] ?? '';
      if (first.startsWith('* ')) {
        const toks = tokenize(r).slice(1);
        if (str(toks[0]).toUpperCase() === 'BYE') this.closed = new ImapError(`The mail server ended the session: ${first.slice(6, 160)}`, 'closed');
        untagged.push(toks);
        continue;
      }
      if (first.startsWith('+')) continue; // no command here sends a literal
      if (first.startsWith(`${tag} `)) {
        const status = parseStatus(first.slice(tag.length + 1));
        if (status.status !== 'OK') throw new ImapError(status.text || status.status, status.status === 'NO' ? 'no' : 'bad', status);
        return { ...status, untagged };
      }
      throw new ImapError(`Unexpected response: ${first.slice(0, 80)}`, 'protocol');
    }
  }

  /** LOGOUT, then closes the stream. Never throws. */
  async logout(): Promise<void> {
    try {
      if (!this.closed) await this.command('LOGOUT');
    } catch {
      /* closing anyway */
    }
    this.socket.destroy();
  }
}

/** A FETCH response's items as a map: name (upper case) to value. */
export function fetchItems(toks: Token[]): Map<string, Token> {
  const out = new Map<string, Token>();
  if (str(toks[1]).toUpperCase() !== 'FETCH' || !Array.isArray(toks[2])) return out;
  const list = toks[2];
  for (let i = 0; i + 1 < list.length; i += 2) out.set(str(list[i]).toUpperCase(), list[i + 1]);
  return out;
}

/** The numbers of a "* SEARCH 1 2 3" response. */
export function searchIds(untagged: Token[][]): number[] {
  const ids: number[] = [];
  for (const t of untagged) {
    if (str(t[0]).toUpperCase() !== 'SEARCH') continue;
    for (const x of t.slice(1)) {
      const n = Number(str(x));
      if (Number.isInteger(n) && n > 0) ids.push(n);
    }
  }
  return ids;
}

export interface ListEntry {
  flags: string[];
  name: string;
}

/** "* LIST (\HasNoChildren \All) "/" "[Gmail]/All Mail"" entries. */
export function listEntries(untagged: Token[][]): ListEntry[] {
  const out: ListEntry[] = [];
  for (const t of untagged) {
    if (str(t[0]).toUpperCase() !== 'LIST' || !Array.isArray(t[1])) continue;
    out.push({ flags: t[1].map((x) => str(x)), name: str(t[3]) });
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** INTERNALDATE ("14-Nov-2026 10:02:03 +0100") as ISO time, or '' when unreadable. */
export function internalDate(s: string): string {
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s);
  if (!m) return '';
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return '';
  const offset = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  const t = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offset * 60_000;
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}
