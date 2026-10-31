/**
 * The fixed network interface every submission must fit, and a tiny inference
 * runtime for it. A submission is data only (a JSON weight file), so the
 * ladder never runs student code.
 *
 * Input: 84 numbers seen from the side to move: cells 0..41 are 1 where the
 * mover has a piece, cells 42..83 are 1 where the opponent has one (cell order
 * as in connect4.ts, bottom row first). Output: 7 logits, one per column.
 * Hidden layers apply the file's activation; the last layer is linear. The
 * move is the legal column with the highest logit, lowest column on ties.
 */
import { CELLS, COLS, type Board, legalMoves } from './connect4';

export const FORMAT = 'tiny-brains/v1';
export const INPUTS = 2 * CELLS;
export const OUTPUTS = COLS;
export const DEFAULT_BUDGET = 5000;
export const MAX_LAYERS = 4;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_ABS_WEIGHT = 1000;

export type Activation = 'relu' | 'tanh';

export interface LayerJson {
  /** weights[o][i]: from input i to output o. */
  weights: number[][];
  bias: number[];
}

export interface BrainFile {
  format: typeof FORMAT;
  name: string;
  author?: string;
  activation: Activation;
  layers: LayerJson[];
  meta?: Record<string, string | number | boolean>;
}

export interface Layer {
  nin: number;
  nout: number;
  w: Float64Array; // row-major [nout][nin]
  b: Float64Array;
}

export interface Net {
  activation: Activation;
  layers: Layer[];
}

export function paramCount(sizes: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < sizes.length; i++) n += sizes[i - 1] * sizes[i] + sizes[i];
  return n;
}

export function netParams(net: Net): number {
  return net.layers.reduce((s, l) => s + l.w.length + l.b.length, 0);
}

export function netSizes(net: Net): number[] {
  return [net.layers[0].nin, ...net.layers.map((l) => l.nout)];
}

export function encode(b: Board, out: Float64Array = new Float64Array(INPUTS)): Float64Array {
  const me = b.toMove;
  for (let i = 0; i < CELLS; i++) {
    const v = b.cells[i];
    out[i] = v === me ? 1 : 0;
    out[CELLS + i] = v !== 0 && v !== me ? 1 : 0;
  }
  return out;
}

function act(a: Activation, x: number): number {
  return a === 'relu' ? (x > 0 ? x : 0) : Math.tanh(x);
}

/** Forward pass. Returns the activations of every layer (index 0 is the input). */
export function forwardAll(net: Net, input: Float64Array): Float64Array[] {
  const acts: Float64Array[] = [input];
  let x = input;
  net.layers.forEach((l, li) => {
    const y = new Float64Array(l.nout);
    const last = li === net.layers.length - 1;
    for (let o = 0; o < l.nout; o++) {
      let s = l.b[o];
      const row = o * l.nin;
      for (let i = 0; i < l.nin; i++) s += l.w[row + i] * x[i];
      y[o] = last ? s : act(net.activation, s);
    }
    acts.push(y);
    x = y;
  });
  return acts;
}

export function logits(net: Net, b: Board): Float64Array {
  const acts = forwardAll(net, encode(b));
  return acts[acts.length - 1];
}

/** Legal column with the highest logit (lowest column on ties). */
export function argmaxLegal(z: ArrayLike<number>, legal: readonly number[]): number {
  let best = legal[0];
  for (const c of legal) if (z[c] > z[best]) best = c;
  return best;
}

export function netMove(net: Net, b: Board): number {
  return argmaxLegal(logits(net, b), legalMoves(b));
}

/** Softmax over legal columns only; illegal columns get 0. */
export function legalSoftmax(z: ArrayLike<number>, legal: readonly number[]): number[] {
  const p = new Array<number>(OUTPUTS).fill(0);
  let m = -Infinity;
  for (const c of legal) m = Math.max(m, z[c]);
  let s = 0;
  for (const c of legal) {
    p[c] = Math.exp(z[c] - m);
    s += p[c];
  }
  for (const c of legal) p[c] /= s;
  return p;
}

export function createNet(sizes: readonly number[], activation: Activation, init: (fanIn: number) => number): Net {
  const layers: Layer[] = [];
  for (let i = 1; i < sizes.length; i++) {
    const nin = sizes[i - 1];
    const nout = sizes[i];
    const w = new Float64Array(nin * nout);
    for (let k = 0; k < w.length; k++) w[k] = init(nin);
    layers.push({ nin, nout, w, b: new Float64Array(nout) });
  }
  return { activation, layers };
}

export function cloneNet(net: Net): Net {
  return { activation: net.activation, layers: net.layers.map((l) => ({ nin: l.nin, nout: l.nout, w: l.w.slice(), b: l.b.slice() })) };
}

function round6(x: number): number {
  return x === 0 ? 0 : Number(x.toPrecision(6));
}

export function toBrainFile(net: Net, name: string, extra: { author?: string; meta?: BrainFile['meta'] } = {}): BrainFile {
  const file: BrainFile = {
    format: FORMAT,
    name,
    activation: net.activation,
    layers: net.layers.map((l) => ({
      weights: Array.from({ length: l.nout }, (_, o) => Array.from(l.w.subarray(o * l.nin, (o + 1) * l.nin), round6)),
      bias: Array.from(l.b, round6),
    })),
  };
  if (extra.author) file.author = extra.author;
  if (extra.meta) file.meta = extra.meta;
  return file;
}

export interface Validation {
  ok: boolean;
  errors: string[];
  params: number;
  sizes: number[];
}

function isNumArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'number');
}

/** Checks a parsed weight file against the interface and the parameter budget. */
export function validateBrain(raw: unknown, budget = DEFAULT_BUDGET): Validation {
  const errors: string[] = [];
  const sizes: number[] = [];
  let params = 0;
  const fail = (): Validation => ({ ok: false, errors, params, sizes });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push('file must be a JSON object');
    return fail();
  }
  const f = raw as Record<string, unknown>;
  if (f.format !== FORMAT) errors.push(`format must be "${FORMAT}"`);
  if (typeof f.name !== 'string' || f.name.trim() === '' || f.name.length > 40) errors.push('name must be a non-empty string of at most 40 characters');
  if (f.author !== undefined && (typeof f.author !== 'string' || f.author.length > 80)) errors.push('author must be a string of at most 80 characters');
  if (f.activation !== 'relu' && f.activation !== 'tanh') errors.push('activation must be "relu" or "tanh"');
  if (!Array.isArray(f.layers) || f.layers.length < 1 || f.layers.length > MAX_LAYERS) {
    errors.push(`layers must be an array of 1 to ${MAX_LAYERS} layers`);
    return fail();
  }
  let nin = INPUTS;
  sizes.push(nin);
  f.layers.forEach((layer: unknown, li: number) => {
    const L = layer as Partial<LayerJson> | null;
    if (typeof L !== 'object' || L === null || !Array.isArray(L.weights) || !isNumArray(L.bias)) {
      errors.push(`layer ${li}: needs a weights matrix and a bias array of numbers`);
      return;
    }
    const nout = L.bias.length;
    if (nout < 1) errors.push(`layer ${li}: bias is empty`);
    if (L.weights.length !== nout) errors.push(`layer ${li}: weights has ${L.weights.length} rows but bias has ${nout}`);
    L.weights.forEach((row, o) => {
      if (!isNumArray(row)) errors.push(`layer ${li} row ${o}: must be an array of numbers`);
      else if (row.length !== nin) errors.push(`layer ${li} row ${o}: has ${row.length} inputs, expected ${nin}`);
    });
    const all = [...L.bias, ...L.weights.flat()];
    if (!all.every((v) => typeof v === 'number' && Number.isFinite(v))) errors.push(`layer ${li}: every weight must be a finite number`);
    else if (all.some((v) => Math.abs(v) > MAX_ABS_WEIGHT)) errors.push(`layer ${li}: weights must be within ±${MAX_ABS_WEIGHT}`);
    params += nin * nout + nout;
    sizes.push(nout);
    nin = nout;
  });
  if (errors.length === 0 && nin !== OUTPUTS) errors.push(`last layer must have ${OUTPUTS} outputs (one per column), has ${nin}`);
  if (params > budget) errors.push(`${params} parameters is over the ${budget} budget`);
  return { ok: errors.length === 0, errors, params, sizes };
}

export function compileBrain(f: BrainFile): Net {
  let nin = INPUTS;
  const layers = f.layers.map((L) => {
    const nout = L.bias.length;
    const w = new Float64Array(nin * nout);
    L.weights.forEach((row, o) => w.set(row, o * nin));
    const layer = { nin, nout, w, b: Float64Array.from(L.bias) };
    nin = nout;
    return layer;
  });
  return { activation: f.activation, layers };
}

/** Parses and validates weight-file text; throws with every problem listed. */
export function parseBrain(text: string, budget = DEFAULT_BUDGET): { file: BrainFile; net: Net; params: number } {
  if (text.length > MAX_FILE_BYTES) throw new Error(`file is larger than ${MAX_FILE_BYTES} bytes`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${(e as Error).message}`);
  }
  const v = validateBrain(raw, budget);
  if (!v.ok) throw new Error(v.errors.join('; '));
  const file = raw as BrainFile;
  return { file, net: compileBrain(file), params: v.params };
}
