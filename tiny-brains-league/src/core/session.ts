/** A full training run as one pure function, so the Web Worker stays a thin shell and runs reproduce from settings. */
import { brainBot, randomBot, scriptedBot } from './bots';
import { type Activation, type BrainFile, INPUTS, type Net, OUTPUTS, compileBrain, netParams, paramCount, toBrainFile } from './net';
import { makeRng } from './rng';
import { type EvalResult, type Teacher, evolve, initNet, makeDataset, mirrorDataset, quickEval, trainEpoch } from './train';

export interface TrainConfig {
  name: string;
  hidden: number[];
  activation: Activation;
  budget: number;
  seed: number;
  imitation: null | { teacher: Teacher; games: number; explore: number; epochs: number; lr: number; mirror: boolean };
  evolution: null | { population: number; elites: number; sigma: number; generations: number; opponents: ('random' | 'scripted')[]; openings: number };
  /** Optional starting weights (fine-tune an existing brain instead of a fresh init). */
  start?: BrainFile;
}

export type TrainEvent =
  | { kind: 'stage'; text: string }
  | { kind: 'epoch'; epoch: number; loss: number; acc: number; eval: EvalResult }
  | { kind: 'generation'; generation: number; best: number; mean: number }
  | { kind: 'done'; brain: BrainFile; params: number; eval: EvalResult; seconds: number };

export const EVAL_OPENINGS = 16;

export function parseHidden(text: string): number[] | null {
  const t = text.trim();
  if (t === '') return [];
  const parts = t.split(/[\s,x×]+/).filter(Boolean);
  if (parts.length > 3) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 512) ? nums : null;
}

export function configParams(c: Pick<TrainConfig, 'hidden'>): number {
  return paramCount([INPUTS, ...c.hidden, OUTPUTS]);
}

export function checkConfig(c: TrainConfig): string[] {
  const errs: string[] = [];
  const p = configParams(c);
  if (p > c.budget) errs.push(`${p} parameters is over the ${c.budget} budget`);
  if (!c.imitation && !c.evolution) errs.push('choose imitation, evolution or both');
  if (c.imitation && (c.imitation.games < 1 || c.imitation.epochs < 1)) errs.push('imitation needs at least one game and one epoch');
  if (c.evolution && (c.evolution.population < 2 || c.evolution.generations < 1 || c.evolution.elites < 1 || c.evolution.elites >= c.evolution.population))
    errs.push('evolution needs population ≥ 2, 1 ≤ elites < population, and at least one generation');
  if (c.evolution && c.evolution.opponents.length === 0) errs.push('evolution needs at least one opponent');
  if (c.start && c.start.layers.length !== c.hidden.length + 1) errs.push('starting brain has a different architecture');
  return errs;
}

const OPP = { random: randomBot, scripted: scriptedBot };

export function evalNet(net: Net, openings = EVAL_OPENINGS): EvalResult {
  return quickEval(brainBot('eval', 'eval', net), openings, OPP);
}

export function runTraining(c: TrainConfig, emit: (e: TrainEvent) => void, now: () => number = () => Date.now()): BrainFile {
  const errs = checkConfig(c);
  if (errs.length) throw new Error(errs.join('; '));
  const t0 = now();
  let net: Net = c.start ? compileBrain(c.start) : initNet([INPUTS, ...c.hidden, OUTPUTS], c.activation, c.seed);
  if (c.imitation) {
    const im = c.imitation;
    emit({ kind: 'stage', text: `Labelling ${im.games} teacher games (${im.teacher})…` });
    let data = makeDataset({ teacher: im.teacher, games: im.games, explore: im.explore, seed: c.seed + 1 });
    if (im.mirror) data = mirrorDataset(data);
    emit({ kind: 'stage', text: `Training on ${data.length} positions…` });
    const rng = makeRng(c.seed + 2);
    let adam;
    for (let e = 1; e <= im.epochs; e++) {
      const r = trainEpoch(net, data, rng, { lr: im.lr, batch: 32, l2: 1e-4 }, adam);
      adam = r.adam;
      emit({ kind: 'epoch', epoch: e, loss: r.loss, acc: r.acc, eval: evalNet(net, 4) });
    }
  }
  if (c.evolution) {
    const ev = c.evolution;
    emit({ kind: 'stage', text: `Evolving ${ev.population} nets for ${ev.generations} generations…` });
    const opps = ev.opponents.map((o) => OPP[o]);
    for (const step of evolve(net, { ...ev, seed: c.seed + 3 }, opps, (n) => brainBot('cand', 'cand', n))) {
      net = step.net;
      emit({ kind: 'generation', generation: step.generation, best: step.best, mean: step.mean });
    }
  }
  const evalResult = evalNet(net);
  const method = [c.imitation ? `imitation(${c.imitation.teacher})` : '', c.evolution ? 'evolution' : ''].filter(Boolean).join('+');
  const brain = toBrainFile(net, c.name, { meta: { method, hidden: c.hidden.join('x') || 'none', seed: c.seed, budget: c.budget } });
  emit({ kind: 'done', brain, params: netParams(net), eval: evalResult, seconds: (now() - t0) / 1000 });
  return brain;
}
