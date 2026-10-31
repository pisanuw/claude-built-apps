export type Command =
  | { name: 'SET'; key: string; value: string; ex: number | null }
  | { name: 'GET'; key: string }
  | { name: 'DEL'; keys: string[] }
  | { name: 'EXPIRE'; key: string; ticks: number }
  | { name: 'TTL'; key: string }
  | { name: 'TICK'; ticks: number }
  | { name: 'RANGE'; lo: string; hi: string }
  | { name: 'FILL'; count: number; prefix: string }
  | { name: 'SEED'; seed: number }
  | { name: 'CAPACITY'; capacity: number }
  | { name: 'RESET' }
  | { name: 'KEYS' }
  | { name: 'HELP' };

export const MAX_KEY_LENGTH = 16;
export const MAX_VALUE_LENGTH = 32;
export const MAX_FILL = 32;

export const HELP_TEXT: readonly [string, string][] = [
  ['SET key value [EX ticks]', 'store a value in every building; EX also sets a time to live'],
  ['GET key', 'look a key up in every building'],
  ['DEL key [key ...]', 'remove keys'],
  ['EXPIRE key ticks', 'the key disappears after that many TICKs'],
  ['TTL key', 'ticks left: -1 means no expiry, -2 means no such key'],
  ['TICK [n]', 'advance the clock (default 1) and sweep expired keys'],
  ['RANGE lo hi', 'every key between lo and hi, inclusive'],
  ['FILL n [prefix]', `SET prefix1..prefixn (n up to ${MAX_FILL}, prefix defaults to k)`],
  ['CAPACITY n', 'resize the LRU cache (evicts if it shrinks)'],
  ['SEED n', 'reset the city with a new skip-list coin seed'],
  ['KEYS', 'list every key in order'],
  ['RESET', 'empty every building and zero the meters'],
  ['HELP', 'this list'],
];

export class ParseError extends Error {}

/** Split a line into words; double quotes group words and \" or \\ escape inside them. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      let word = '';
      i++;
      for (;;) {
        if (i >= line.length) throw new ParseError('unclosed quote');
        const c = line[i];
        if (c === '\\' && i + 1 < line.length) {
          word += line[i + 1];
          i += 2;
        } else if (c === '"') {
          i++;
          break;
        } else {
          word += c;
          i++;
        }
      }
      out.push(word);
    } else {
      let word = '';
      while (i < line.length && !/\s/.test(line[i])) word += line[i++];
      out.push(word);
    }
  }
  return out;
}

function key(word: string | undefined, what = 'key'): string {
  if (word === undefined || word === '') throw new ParseError(`missing ${what}`);
  if (word.length > MAX_KEY_LENGTH) throw new ParseError(`${what} is longer than ${MAX_KEY_LENGTH} characters`);
  return word;
}

function int(word: string | undefined, what: string, min: number, max: number): number {
  if (word === undefined) throw new ParseError(`missing ${what}`);
  if (!/^-?\d+$/.test(word)) throw new ParseError(`${what} must be a whole number`);
  const n = Number(word);
  if (n < min || n > max) throw new ParseError(`${what} must be between ${min} and ${max}`);
  return n;
}

function arity(args: string[], min: number, max: number, usage: string): void {
  if (args.length < min || args.length > max) throw new ParseError(`usage: ${usage}`);
}

export function parseCommand(line: string): Command {
  const words = tokenize(line);
  if (words.length === 0) throw new ParseError('empty command');
  const name = words[0].toUpperCase();
  const args = words.slice(1);
  switch (name) {
    case 'SET': {
      if (args.length !== 2 && args.length !== 4) throw new ParseError('usage: SET key value [EX ticks]');
      const value = args[1];
      if (value.length > MAX_VALUE_LENGTH) throw new ParseError(`value is longer than ${MAX_VALUE_LENGTH} characters`);
      let ex: number | null = null;
      if (args.length === 4) {
        if (args[2].toUpperCase() !== 'EX') throw new ParseError('usage: SET key value [EX ticks]');
        ex = int(args[3], 'EX ticks', 1, 1000);
      }
      return { name, key: key(args[0]), value, ex };
    }
    case 'GET':
      arity(args, 1, 1, 'GET key');
      return { name, key: key(args[0]) };
    case 'DEL':
      if (args.length < 1) throw new ParseError('usage: DEL key [key ...]');
      return { name, keys: args.map((a) => key(a)) };
    case 'EXPIRE':
      arity(args, 2, 2, 'EXPIRE key ticks');
      return { name, key: key(args[0]), ticks: int(args[1], 'ticks', 1, 1000) };
    case 'TTL':
      arity(args, 1, 1, 'TTL key');
      return { name, key: key(args[0]) };
    case 'TICK':
      arity(args, 0, 1, 'TICK [n]');
      return { name, ticks: args.length ? int(args[0], 'ticks', 1, 1000) : 1 };
    case 'RANGE':
      arity(args, 2, 2, 'RANGE lo hi');
      return { name, lo: key(args[0], 'lo'), hi: key(args[1], 'hi') };
    case 'FILL':
      arity(args, 1, 2, 'FILL n [prefix]');
      return { name, count: int(args[0], 'n', 1, MAX_FILL), prefix: args.length > 1 ? key(args[1], 'prefix') : 'k' };
    case 'SEED':
      arity(args, 1, 1, 'SEED n');
      return { name, seed: int(args[0], 'seed', 0, 2 ** 31 - 1) };
    case 'CAPACITY':
      arity(args, 1, 1, 'CAPACITY n');
      return { name, capacity: int(args[0], 'capacity', 1, 16) };
    case 'RESET':
    case 'KEYS':
    case 'HELP':
      arity(args, 0, 0, name);
      return { name };
    default:
      throw new ParseError(`unknown command '${words[0]}' (try HELP)`);
  }
}
