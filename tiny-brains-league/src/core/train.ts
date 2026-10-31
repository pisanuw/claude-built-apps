/**
 * Two training methods that run in the browser: supervised imitation of a
 * house bot, and a simple evolution strategy. Both are seeded and pure, so a
 * run reproduces from its settings.
 */
import { type Bot, bestMoves, randomBot, scriptedMove } from './bots';
import { type Board, isWinningMove, legalMoves, newBoard, outcomeAfter, other, play } from './connect4';
import { playPair, pickOpenings } from './match';
import { type Activation, INPUTS, type Net, OUTPUTS, cloneNet, createNet, encode, forwardAll, legalSoftmax } from './net';
import { type Rng, gaussian, makeRng, randInt } from './rng';

export type Teacher = 'scripted' | 'lookahead2' | 'lookahead4';

export interface Sample {
  x: Float64Array;
  legal: number[];
  /** Target distribution over the 7 columns. */
  y: Float64Array;
}

/** Columns the teacher considers best (all ties), used as a uniform soft target. */
export function teacherTargets(b: Board, teacher: Teacher): number[] {
  if (teacher === 'scripted') {
    // The scripted bot breaks ties randomly; collect every column it could pick.
    const seen = new Set<number>();
    for (let s = 0; s < 12; s++) seen.add(scriptedMove(b, makeRng(s)));
    return [...seen].sort((a, c) => a - c);
  }
  return bestMoves(b, teacher === 'lookahead2' ? 2 : 4).sort((a, c) => a - c);
}

export interface DatasetOptions {
  teacher: Teacher;
  games: number;
  /** Chance each move is random instead of the teacher's, so the data covers off-teacher positions. */
  explore: number;
  seed: number;
}

/** Plays teacher-vs-teacher games with exploration noise, labelling each position. */
export function makeDataset(opts: DatasetOptions): Sample[] {
  const rng = makeRng(opts.seed);
  const out: Sample[] = [];
  for (let g = 0; g < opts.games; g++) {
    const b = newBoard();
    let last = play(b, randInt(rng, 7));
    while (outcomeAfter(b, last) === null) {
      const legal = legalMoves(b);
      const best = teacherTargets(b, opts.teacher);
      const y = new Float64Array(OUTPUTS);
      for (const c of best) y[c] = 1 / best.length;
      out.push({ x: encode(b), legal, y });
      const col = rng() < opts.explore ? legal[randInt(rng, legal.length)] : best[randInt(rng, best.length)];
      last = play(b, col);
    }
  }
  return out;
}

/** Adds the left-right mirror of every sample (Connect Four is symmetric). */
export function mirrorDataset(data: readonly Sample[]): Sample[] {
  const out = data.slice();
  for (const s of data) {
    const x = new Float64Array(INPUTS);
    for (let i = 0; i < INPUTS; i++) {
      const plane = i < 42 ? 0 : 42;
      const cell = i - plane;
      const c = cell % 7;
      x[plane + cell - c + (6 - c)] = s.x[i];
    }
    const y = new Float64Array(OUTPUTS);
    for (let c = 0; c < OUTPUTS; c++) y[6 - c] = s.y[c];
    out.push({ x, legal: s.legal.map((c) => 6 - c).sort((a, b) => a - b), y });
  }
  return out;
}

export function initNet(sizes: readonly number[], activation: Activation, seed: number): Net {
  const rng = makeRng(seed);
  return createNet(sizes, activation, (fanIn) => gaussian(rng) * Math.sqrt((activation === 'relu' ? 2 : 1) / fanIn));
}

interface Adam {
  m: Float64Array[];
  v: Float64Array[];
  t: number;
}

function adamFor(net: Net): Adam {
  const parts = net.layers.flatMap((l) => [l.w, l.b]);
  return { m: parts.map((p) => new Float64Array(p.length)), v: parts.map((p) => new Float64Array(p.length)), t: 0 };
}

/** Cross-entropy of the legal-masked softmax against the target, and whether the argmax hits a target column. */
export function sampleLoss(net: Net, s: Sample): { loss: number; hit: boolean } {
  const acts = forwardAll(net, s.x);
  const p = legalSoftmax(acts[acts.length - 1], s.legal);
  let loss = 0;
  let top = s.legal[0];
  for (const c of s.legal) {
    if (s.y[c] > 0) loss -= s.y[c] * Math.log(Math.max(p[c], 1e-12));
    if (p[c] > p[top]) top = c;
  }
  return { loss, hit: s.y[top] > 0 };
}

/** One epoch of minibatch Adam on the samples (shuffled with `rng`). Returns mean loss and accuracy. */
export function trainEpoch(net: Net, data: readonly Sample[], rng: Rng, opt: { lr: number; batch: number; l2: number }, adam: Adam = adamFor(net)): { loss: number; acc: number; adam: Adam } {
  const order = data.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const params = net.layers.flatMap((l) => [l.w, l.b]);
  const grads = params.map((p) => new Float64Array(p.length));
  let lossSum = 0;
  let hits = 0;
  const L = net.layers.length;
  for (let start = 0; start < order.length; start += opt.batch) {
    grads.forEach((g) => g.fill(0));
    const end = Math.min(order.length, start + opt.batch);
    for (let k = start; k < end; k++) {
      const s = data[order[k]];
      const acts = forwardAll(net, s.x);
      const p = legalSoftmax(acts[L], s.legal);
      let top = s.legal[0];
      for (const c of s.legal) {
        if (s.y[c] > 0) lossSum -= s.y[c] * Math.log(Math.max(p[c], 1e-12));
        if (p[c] > p[top]) top = c;
      }
      if (s.y[top] > 0) hits++;
      // dL/dz = p - y on legal columns, 0 on illegal ones.
      let delta = new Float64Array(OUTPUTS);
      for (const c of s.legal) delta[c] = p[c] - s.y[c];
      for (let li = L - 1; li >= 0; li--) {
        const layer = net.layers[li];
        const x = acts[li];
        const gw = grads[2 * li];
        const gb = grads[2 * li + 1];
        const prev = new Float64Array(layer.nin);
        for (let o = 0; o < layer.nout; o++) {
          const d = delta[o];
          if (d === 0) continue;
          gb[o] += d;
          const row = o * layer.nin;
          for (let i = 0; i < layer.nin; i++) {
            gw[row + i] += d * x[i];
            prev[i] += d * layer.w[row + i];
          }
        }
        if (li > 0) {
          const a = acts[li];
          for (let i = 0; i < layer.nin; i++) prev[i] *= net.activation === 'relu' ? (a[i] > 0 ? 1 : 0) : 1 - a[i] * a[i];
        }
        delta = prev;
      }
    }
    const n = end - start;
    adam.t++;
    const b1 = 0.9;
    const b2 = 0.999;
    const c1 = 1 - b1 ** adam.t;
    const c2 = 1 - b2 ** adam.t;
    params.forEach((p, pi) => {
      const g = grads[pi];
      const m = adam.m[pi];
      const v = adam.v[pi];
      const isWeight = pi % 2 === 0;
      for (let i = 0; i < p.length; i++) {
        const gi = g[i] / n + (isWeight ? opt.l2 * p[i] : 0);
        m[i] = b1 * m[i] + (1 - b1) * gi;
        v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        p[i] -= (opt.lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    });
  }
  return { loss: lossSum / Math.max(1, data.length), acc: hits / Math.max(1, data.length), adam };
}

export interface EvalResult {
  vsRandom: number;
  vsScripted: number;
}

/** Score fraction (0..1) of a bot against Random and Scripted over fixed openings. */
export function quickEval(bot: Bot, openings = 8, opponents: { random: Bot; scripted: Bot }): EvalResult {
  const ops = pickOpenings(openings);
  const r = playPair(bot, opponents.random, ops);
  const s = playPair(bot, opponents.scripted, ops);
  return { vsRandom: r.scoreA / r.games.length, vsScripted: s.scoreA / s.games.length };
}

export interface EvolveOptions {
  population: number;
  elites: number;
  sigma: number;
  generations: number;
  seed: number;
  /** Fitness openings per opponent (each played with both colours). */
  openings: number;
}

/** Fitness: points against the opponents, with a small bonus for each tactical test the net passes. */
export function fitness(net: Net, opponents: readonly Bot[], openings: number[][], mkBot: (n: Net) => Bot): number {
  const bot = mkBot(net);
  let s = 0;
  for (const o of opponents) s += playPair(bot, o, openings).scoreA;
  return s + 0.25 * tacticScore(net);
}

/** Fixed positions where one move wins or one move is forced (block). Returns how many the net gets right. */
export const TACTICS: readonly { moves: number[]; answer: number }[] = [
  { moves: [3, 3, 2, 2, 1, 1], answer: 0 }, // complete a horizontal four (either end works; 0 and 4)
  { moves: [0, 1, 0, 1, 0, 1], answer: 0 }, // vertical four
  { moves: [3, 0, 3, 0, 3], answer: 3 }, // block vertical
  { moves: [6, 2, 6, 3, 5, 4], answer: 1 }, // block or win on row 0: X at 6,6,5? opponent threatens 1 and 5
  { moves: [6, 6, 5, 5, 4, 4], answer: 3 }, // horizontal win at 3
];

export function tacticScore(net: Net): number {
  let n = 0;
  for (const t of TACTICS) {
    const b = newBoard();
    for (const m of t.moves) play(b, m);
    const acts = forwardAll(net, encode(b));
    const legal = legalMoves(b);
    const z = acts[acts.length - 1];
    let best = legal[0];
    for (const c of legal) if (z[c] > z[best]) best = c;
    if (isWinningMove(b, best) || (!legal.some((c) => isWinningMove(b, c)) && isWinningMove(b, best, other(b.toMove)))) n++;
  }
  return n;
}

export interface EvolveStep {
  generation: number;
  best: number;
  mean: number;
  net: Net;
}

/** Truncation-selection evolution strategy starting from `start`. Yields after every generation. */
export function* evolve(start: Net, opts: EvolveOptions, opponents: readonly Bot[], mkBot: (n: Net) => Bot): Generator<EvolveStep> {
  const rng = makeRng(opts.seed);
  const openings = pickOpenings(opts.openings);
  let parents: Net[] = [cloneNet(start)];
  for (let gen = 1; gen <= opts.generations; gen++) {
    const pop: Net[] = parents.map(cloneNet);
    while (pop.length < opts.population) {
      const child = cloneNet(parents[randInt(rng, parents.length)]);
      for (const l of child.layers) {
        for (let i = 0; i < l.w.length; i++) l.w[i] += opts.sigma * gaussian(rng);
        for (let i = 0; i < l.b.length; i++) l.b[i] += opts.sigma * gaussian(rng);
      }
      pop.push(child);
    }
    const scored = pop.map((n) => ({ n, f: fitness(n, opponents, openings, mkBot) }));
    scored.sort((a, b) => b.f - a.f);
    parents = scored.slice(0, Math.max(1, opts.elites)).map((s) => s.n);
    yield { generation: gen, best: scored[0].f, mean: scored.reduce((s, x) => s + x.f, 0) / scored.length, net: cloneNet(scored[0].n) };
  }
}

export const DEFAULT_OPPONENTS: readonly Bot[] = [randomBot];
