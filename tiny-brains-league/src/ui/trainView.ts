import { INPUTS, OUTPUTS, DEFAULT_BUDGET } from '../core/net';
import { RANDOM_TARGET, SCRIPTED_TARGET } from '../core/milestones';
import { type TrainConfig, type TrainEvent, checkConfig, configParams, parseHidden } from '../core/session';
import type { Teacher } from '../core/train';
import { toCsv, toMarkdown } from '../core/experiments';
import { clear, field, h, numberInput, s, select } from './dom';
import { addBrain, download, state, subscribe, uniqueName, notify } from './state';

const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Form {
  name: string;
  hidden: string;
  activation: 'relu' | 'tanh';
  seed: number;
  useImitation: boolean;
  teacher: Teacher;
  games: number;
  explore: number;
  epochs: number;
  lr: number;
  mirror: boolean;
  useEvolution: boolean;
  population: number;
  generations: number;
  sigma: number;
  oppScripted: boolean;
  startFrom: string;
}

const PRESETS: { label: string; form: Partial<Form> }[] = [
  { label: 'Quick start (32 hidden, imitate Scripted)', form: { hidden: '32', useImitation: true, teacher: 'scripted', games: 600, epochs: 12, useEvolution: false } },
  { label: 'Tiny (8 hidden)', form: { hidden: '8', useImitation: true, teacher: 'scripted', games: 600, epochs: 15, useEvolution: false } },
  { label: 'Budget max (54 hidden)', form: { hidden: '54', useImitation: true, teacher: 'scripted', games: 1000, epochs: 15, useEvolution: false } },
  { label: 'Evolution only (16 hidden)', form: { hidden: '16', useImitation: false, useEvolution: true, population: 16, generations: 15, sigma: 0.05 } },
];

export function trainView(): HTMLElement {
  const f: Form = { name: 'my-brain', hidden: '32', activation: 'relu', seed: 1, useImitation: true, teacher: 'scripted', games: 600, explore: 0.15, epochs: 12, lr: 0.003, mirror: true, useEvolution: false, population: 16, generations: 10, sigma: 0.05, oppScripted: true, startFrom: '' };
  const root = h('section', { class: 'view' });
  const formBox = h('div', { class: 'panel' });
  const status = h('div', { class: 'panel', 'aria-live': 'polite' });
  const logBox = h('div', { class: 'panel' });
  let worker: Worker | null = null;

  function config(): TrainConfig | string {
    const hidden = parseHidden(f.hidden);
    if (!hidden) return 'hidden layers: up to three whole numbers, for example "32" or "16, 16"';
    const start = state.brains.find((b) => b.id === f.startFrom)?.file;
    return {
      name: f.name.trim().slice(0, 40) || 'my-brain',
      hidden,
      activation: start ? start.activation : f.activation,
      budget: DEFAULT_BUDGET,
      seed: f.seed,
      imitation: f.useImitation ? { teacher: f.teacher, games: f.games, explore: f.explore, epochs: f.epochs, lr: f.lr, mirror: f.mirror } : null,
      evolution: f.useEvolution ? { population: f.population, elites: Math.max(1, Math.floor(f.population / 4)), sigma: f.sigma, generations: f.generations, opponents: f.oppScripted ? ['random', 'scripted'] : ['random'], openings: 4 } : null,
      start,
    };
  }

  function drawForm(): void {
    clear(formBox);
    const c = config();
    const hidden = parseHidden(f.hidden);
    const params = hidden ? configParams({ hidden }) : NaN;
    const errs = typeof c === 'string' ? [c] : checkConfig(c);
    const meter = h('div', { class: 'budget' }, h('div', { class: `budget-fill${params > DEFAULT_BUDGET ? ' over' : ''}`, style: `width:${Math.min(100, (params / DEFAULT_BUDGET) * 100) || 0}%` }));
    const redraw = (fn: () => void) => () => {
      fn();
      drawForm();
    };
    formBox.append(
      h('h2', {}, 'Train a brain'),
      h('p', { class: 'muted' }, `Every brain is a plain multilayer perceptron: ${INPUTS} inputs (your pieces, their pieces), your hidden layers, ${OUTPUTS} outputs (one per column). The budget is ${DEFAULT_BUDGET.toLocaleString()} weights and biases.`),
      h('div', { class: 'preset-row' }, ...PRESETS.map((p) => h('button', { type: 'button', class: 'chip', onclick: redraw(() => Object.assign(f, p.form)) }, p.label))),
      h(
        'div',
        { class: 'grid' },
        field('Name', h('input', { value: f.name, maxlength: 40, oninput: (e: Event) => (f.name = (e.target as HTMLInputElement).value) })),
        field('Hidden layers', h('input', { value: f.hidden, oninput: (e: Event) => { f.hidden = (e.target as HTMLInputElement).value; drawSoon(); } }), 'comma separated, e.g. 32 or 16,16'),
        field('Activation', select([{ value: 'relu', label: 'ReLU' }, { value: 'tanh', label: 'tanh' }], f.activation, (v) => (f.activation = v))),
        field('Seed', numberInput(f.seed, 1, (v) => (f.seed = Math.trunc(v)))),
        field('Start from', select([{ value: '', label: 'fresh random weights' }, ...state.brains.map((b) => ({ value: b.id, label: `${b.file.name} (${b.params})` }))], f.startFrom, (v) => { f.startFrom = v; drawForm(); }), 'fine-tune an existing brain (same hidden sizes)'),
      ),
      h('p', { class: 'budget-line' }, h('strong', {}, Number.isFinite(params) ? `${params.toLocaleString()} parameters` : '—'), ` of ${DEFAULT_BUDGET.toLocaleString()}`),
      meter,
      h(
        'fieldset',
        {},
        h('legend', {}, h('label', {}, h('input', { type: 'checkbox', checked: f.useImitation, onchange: redraw(() => (f.useImitation = !f.useImitation)) }), ' Imitation (supervised)')),
        h(
          'div',
          { class: 'grid', hidden: !f.useImitation },
          field('Teacher', select([{ value: 'scripted', label: 'Scripted heuristic' }, { value: 'lookahead2', label: 'Lookahead-2 search' }, { value: 'lookahead4', label: 'Lookahead-4 search (slow)' }], f.teacher, (v) => (f.teacher = v))),
          field('Teacher games', numberInput(f.games, 50, (v) => (f.games = Math.max(1, Math.trunc(v))), { min: 1, max: 5000 })),
          field('Exploration', numberInput(f.explore, 0.05, (v) => (f.explore = Math.min(1, Math.max(0, v))), { min: 0, max: 1 }), 'chance of a random move while generating data'),
          field('Epochs', numberInput(f.epochs, 1, (v) => (f.epochs = Math.max(1, Math.trunc(v))), { min: 1, max: 200 })),
          field('Learning rate', numberInput(f.lr, 0.001, (v) => (f.lr = v))),
          field('Mirror data', h('input', { type: 'checkbox', checked: f.mirror, onchange: () => (f.mirror = !f.mirror) }), 'add left-right flips'),
        ),
      ),
      h(
        'fieldset',
        {},
        h('legend', {}, h('label', {}, h('input', { type: 'checkbox', checked: f.useEvolution, onchange: redraw(() => (f.useEvolution = !f.useEvolution)) }), ' Evolution (runs after imitation if both are on)')),
        h(
          'div',
          { class: 'grid', hidden: !f.useEvolution },
          field('Population', numberInput(f.population, 1, (v) => (f.population = Math.max(2, Math.trunc(v))), { min: 2, max: 64 })),
          field('Generations', numberInput(f.generations, 1, (v) => (f.generations = Math.max(1, Math.trunc(v))), { min: 1, max: 200 })),
          field('Mutation σ', numberInput(f.sigma, 0.01, (v) => (f.sigma = Math.max(0, v)))),
          field('Fitness vs Scripted too', h('input', { type: 'checkbox', checked: f.oppScripted, onchange: () => (f.oppScripted = !f.oppScripted) }), 'otherwise only vs Random'),
        ),
      ),
      errs.length ? h('ul', { class: 'errors' }, ...errs.map((e) => h('li', {}, e))) : '',
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', disabled: errs.length > 0 || worker !== null, onclick: start }, worker ? 'Training…' : 'Train'), worker ? h('button', { type: 'button', onclick: stop }, 'Stop') : null),
    );
  }

  let pending = 0;
  function drawSoon(): void {
    clearTimeout(pending);
    pending = window.setTimeout(drawForm, 250);
  }

  function stop(): void {
    worker?.terminate();
    worker = null;
    drawForm();
    status.append(h('p', { class: 'warn' }, 'Stopped.'));
  }

  function start(): void {
    const c = config();
    if (typeof c === 'string' || checkConfig(c).length) return;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const epochs: { loss: number; acc: number }[] = [];
    const gens: { best: number; mean: number }[] = [];
    const stage = h('p', {}, 'Starting…');
    const chart = h('div', {});
    clear(status);
    status.append(h('h2', {}, `Training ${c.name}`), stage, chart);
    worker.onmessage = (ev: MessageEvent<{ type: string; event?: TrainEvent; message?: string }>) => {
      if (ev.data.type === 'error') {
        status.append(h('p', { class: 'bad' }, ev.data.message ?? 'error'));
        worker?.terminate();
        worker = null;
        drawForm();
        return;
      }
      const e = ev.data.event;
      if (!e) return;
      if (e.kind === 'stage') stage.textContent = e.text;
      else if (e.kind === 'epoch') {
        epochs.push(e);
        stage.textContent = `Epoch ${e.epoch}: loss ${e.loss.toFixed(3)}, matches teacher on ${pct(e.acc)} of positions; quick check vs Random ${pct(e.eval.vsRandom)}, vs Scripted ${pct(e.eval.vsScripted)}`;
        chart.replaceChildren(lineChart(epochs.map((x) => x.acc), 'Teacher agreement per epoch'));
      } else if (e.kind === 'generation') {
        gens.push(e);
        stage.textContent = `Generation ${e.generation}: best fitness ${e.best.toFixed(2)}, mean ${e.mean.toFixed(2)}`;
        chart.replaceChildren(lineChart(gens.map((x) => x.best), 'Best fitness per generation', false));
      } else {
        worker?.terminate();
        worker = null;
        const file = { ...e.brain, name: uniqueName(e.brain.name) };
        const entry = addBrain(file, 'trained', e.params, e.eval);
        state.runs.push({
          id: entry.id, name: file.name, hidden: c.hidden.join('x') || 'none', activation: c.activation, params: e.params, method: String(file.meta?.method ?? ''),
          teacher: c.imitation?.teacher ?? '-', games: c.imitation?.games ?? 0, epochs: c.imitation?.epochs ?? 0, generations: c.evolution?.generations ?? 0, seed: c.seed,
          vsRandom: e.eval.vsRandom, vsScripted: e.eval.vsScripted, seconds: Math.round(e.seconds), at: new Date().toISOString(),
        });
        notify();
        stage.replaceChildren(
          h('strong', {}, `${file.name}: ${e.params.toLocaleString()} parameters, trained in ${e.seconds.toFixed(0)} s. `),
          `Over 32 games each: ${pct(e.eval.vsRandom)} vs Random (milestone ${pct(RANDOM_TARGET)}), ${pct(e.eval.vsScripted)} vs Scripted (milestone above ${pct(SCRIPTED_TARGET)}). Saved to Brains.`,
        );
        status.append(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => download(`${file.name}.json`, JSON.stringify(file)) }, 'Download weights'), h('a', { href: '#ladder', class: 'button' }, 'Enter the ladder')));
        drawForm();
      }
    };
    worker.postMessage({ type: 'train', config: c });
    drawForm();
  }

  function drawLog(): void {
    clear(logBox);
    logBox.append(h('h2', {}, 'Experiment log (for your ablation)'));
    if (!state.runs.length) {
      logBox.append(h('p', { class: 'muted' }, 'Every finished run is logged here with its settings and scores. Train at least two budgets or methods to compare.'));
      return;
    }
    const table = h('table', {}, h('thead', {}, h('tr', {}, ...['Name', 'Hidden', 'Params', 'Method', 'Seed', 'vs Random', 'vs Scripted', 's'].map((t) => h('th', { scope: 'col' }, t)))));
    const body = h('tbody', {});
    for (const r of state.runs) body.append(h('tr', {}, h('td', {}, r.name), h('td', {}, r.hidden), h('td', { class: 'num' }, r.params.toLocaleString()), h('td', {}, r.method), h('td', { class: 'num' }, String(r.seed)), h('td', { class: 'num' }, pct(r.vsRandom)), h('td', { class: 'num' }, pct(r.vsScripted)), h('td', { class: 'num' }, String(r.seconds))));
    table.append(body);
    logBox.append(
      h('div', { class: 'table-wrap' }, table),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', onclick: () => download('ablation.md', toMarkdown(state.runs), 'text/markdown') }, 'Export Markdown'),
        h('button', { type: 'button', onclick: () => download('ablation.csv', toCsv(state.runs), 'text/csv') }, 'Export CSV'),
        h('button', { type: 'button', onclick: () => { if (confirm('Clear the experiment log?')) { state.runs = []; notify(); } } }, 'Clear log'),
      ),
    );
  }

  subscribe(drawLog);
  drawForm();
  drawLog();
  root.append(formBox, status, logBox);
  return root;
}

function lineChart(values: number[], title: string, unit = true): SVGSVGElement {
  const W = 320;
  const H = 120;
  const max = unit ? 1 : Math.max(...values, 1e-9);
  const min = unit ? 0 : Math.min(...values, 0);
  const x = (i: number) => 30 + (values.length === 1 ? 0 : (i / (values.length - 1)) * (W - 40));
  const y = (v: number) => H - 20 - ((v - min) / (max - min || 1)) * (H - 35);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${title}: latest ${values[values.length - 1].toFixed(3)}` },
    s('text', { x: 30, y: 12, class: 'chart-title' }, title),
    s('line', { x1: 30, y1: H - 20, x2: W - 10, y2: H - 20, class: 'axis' }),
    s('text', { x: 2, y: y(max) + 4, class: 'tick' }, unit ? '100%' : max.toFixed(1)),
    s('text', { x: 2, y: y(min) + 4, class: 'tick' }, unit ? '0%' : min.toFixed(1)),
    s('polyline', { points: pts, class: 'series' }),
  );
}
