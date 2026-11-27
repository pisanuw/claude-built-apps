import {
  daysToDrift,
  formatDuration,
  formatError,
  formatSecondsPerDay,
  rateError,
  secondsPerDay,
  turnsAhead,
} from '../core/drift';
import { parseExpression } from '../core/expr';
import { continuedFraction, convergents, formatRuns, relError, sternBrocotRuns } from '../core/fractions';
import { gearDims, gearOutline, layoutTrain, outlinePath, trainBounds, type Arbor } from '../core/gear';
import { cutSheet } from '../core/cutfile';
import { DEFAULT_LIMITS, PRESETS } from '../core/presets';
import { buildableStages, makeTrain, searchTrains, validateLimits, type Limits, type Train } from '../core/search';
import { DEFAULT_MODULE, decodeState, encodeState, encodeTrain } from '../core/share';
import { el, svg } from './dom';

interface State {
  target: string;
  limits: Limits;
  module: number;
  value: number | null;
  trains: Train[];
  bestByStages: (Train | null)[];
  selected: Train | null;
}

export function mountApp(root: HTMLElement): void {
  const shared = decodeState(location.hash);
  const state: State = {
    target: shared?.target ?? '365.2422/366.2422',
    limits: shared?.limits ?? { ...DEFAULT_LIMITS },
    module: shared?.module ?? DEFAULT_MODULE,
    value: null,
    trains: [],
    bestByStages: [],
    selected: null,
  };

  const targetInput = el('input', { id: 'target', type: 'text', value: state.target, spellcheck: 'false', autocomplete: 'off' });
  const presetSelect = el(
    'select',
    { id: 'preset', 'aria-label': 'Presets' },
    el('option', { value: '' }, 'Presets…'),
    ...PRESETS.map((p) => el('option', { value: p.id }, p.name)),
  );
  const num = (id: string, value: number, min: number, max: number, step = 1) =>
    el('input', { id, type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) });
  const minInput = num('min', state.limits.minTeeth, 6, 200);
  const maxInput = num('max', state.limits.maxTeeth, 6, 200);
  const stagesInput = num('stages', state.limits.maxStages, 1, 3);
  const moduleInput = num('module', state.module, 0.3, 20, 0.1);
  const note = el('p', { class: 'note', id: 'preset-note' });
  const formError = el('p', { class: 'error', role: 'alert' });
  const parsed = el('p', { class: 'parsed' });

  const form = el(
    'form',
    { class: 'card controls', novalidate: '' },
    el(
      'div',
      { class: 'target-row' },
      el(
        'label',
        { for: 'target' },
        'Target reduction ',
        el('span', { class: 'hint' }, '(input turns per one output turn; arithmetic and a:b allowed)'),
      ),
      el('div', { class: 'inline' }, targetInput, presetSelect),
      parsed,
      note,
    ),
    el(
      'div',
      { class: 'limits' },
      el('label', {}, 'Fewest teeth', minInput),
      el('label', {}, 'Most teeth', maxInput),
      el('label', {}, 'Max stages', stagesInput),
      el('label', {}, 'Module (mm)', moduleInput),
      el('button', { type: 'submit', class: 'primary' }, 'Find trains'),
    ),
    formError,
  );

  const summary = el('div', { class: 'summary' });
  const bestCards = el('div', { class: 'best-cards' });
  const tableBody = el('tbody');
  const table = el(
    'table',
    { class: 'trains' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Stages (driver → driven)'),
        el('th', {}, 'Ratio'),
        el('th', {}, 'Error'),
        el('th', {}, 'As a clock'),
        el('th', {}, 'Teeth'),
      ),
    ),
    tableBody,
  );
  const cfPanel = el('div', { class: 'cf' });

  const viewTitle = el('h2', {}, 'Gear train');
  const viewInfo = el('p', { class: 'view-info' });
  const gearSvg = svg('svg', { class: 'gears', role: 'img', 'aria-label': 'Animated gear train' });
  const playBtn = el('button', { type: 'button' }, 'Pause');
  const speedInput = el('input', { type: 'range', min: '0', max: '100', value: '40', 'aria-label': 'Input speed' });
  const shareBtn = el('button', { type: 'button' }, 'Copy share link');
  const cutBtn = el('button', { type: 'button' }, 'Download SVG for laser cutting');
  const status = el('span', { class: 'status', role: 'status' });

  const dial = svg('svg', { class: 'dial', viewBox: '-110 -110 220 220', role: 'img', 'aria-label': 'Drift against an ideal hand' });
  const driftInput = el('input', { type: 'range', min: '0', max: '80', value: '30', 'aria-label': 'Elapsed output turns' });
  const driftText = el('p', { class: 'drift-text' });

  const view = el(
    'section',
    { class: 'card view' },
    viewTitle,
    viewInfo,
    gearSvg,
    el('div', { class: 'toolbar' }, playBtn, el('label', { class: 'speed' }, 'Speed', speedInput), shareBtn, cutBtn, status),
    el('h3', {}, 'Drift against an ideal hand'),
    el(
      'div',
      { class: 'drift' },
      dial,
      el(
        'div',
        {},
        el('label', { class: 'speed' }, 'Elapsed output turns', driftInput),
        driftText,
        el(
          'p',
          { class: 'hint' },
          'The grey hand is where the output should be; the coloured hand is where this train puts it. Both start together; the slider runs time forward on a log scale.',
        ),
      ),
    ),
  );

  root.append(
    el(
      'header',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, 'Brocot Gear Finder'), el('hw-theme-toggle')),
      el(
        'p',
        { class: 'lede' },
        'Real gears have whole numbers of teeth, so most ratios can only be approximated. Enter a target and this page searches every 1 to 3 stage train in your tooth range, walks the Stern-Brocot tree and continued fraction toward it, and animates the result.',
      ),
    ),
    form,
    el('section', { class: 'card results' }, el('h2', {}, 'Trains'), summary, bestCards, el('div', { class: 'table-wrap' }, table)),
    view,
    el('section', { class: 'card' }, el('h2', {}, 'Continued fraction and Stern-Brocot path'), cfPanel),
    el(
      'footer',
      {},
      'Runs entirely in your browser. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/brocot-gear-finder' }, 'Source'),
      ' · idea from ',
      el('a', { href: 'https://github.com/pisanuw/daily-project-ideas' }, 'daily-project-ideas'),
    ),
  );

  // --- Animation state -------------------------------------------------------
  let arbors: Arbor[] = [];
  let gearNodes: { node: SVGGElement; arbor: Arbor }[] = [];
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let inputTurns = 0;
  let last = performance.now();
  playBtn.textContent = playing ? 'Pause' : 'Play';

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      // Slider 0..100 maps to 0.02..2 input turns per second, log scale.
      inputTurns += dt * 0.02 * 100 ** (Number(speedInput.value) / 100);
      drawRotation();
    }
    requestAnimationFrame(frame);
  };
  const drawRotation = () => {
    for (const { node, arbor } of gearNodes) {
      const deg = ((arbor.phase + 2 * Math.PI * arbor.speed * inputTurns) * 180) / Math.PI;
      node.setAttribute('transform', `translate(${arbor.x.toFixed(2)} ${arbor.y.toFixed(2)}) rotate(${(deg % 360).toFixed(3)})`);
    }
  };
  requestAnimationFrame(frame);

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  });

  // --- Rendering -------------------------------------------------------------
  const readForm = (): string | null => {
    state.target = targetInput.value;
    state.limits = {
      minTeeth: Number(minInput.value),
      maxTeeth: Number(maxInput.value),
      maxStages: Number(stagesInput.value),
    };
    state.module = Number(moduleInput.value) > 0 ? Number(moduleInput.value) : DEFAULT_MODULE;
    const res = parseExpression(state.target);
    if (!res.ok) return res.error;
    if (!(res.value > 0)) return 'The target must be positive';
    if (res.value > 1e6 || res.value < 1e-6) return 'Keep the target between 0.000001 and 1,000,000';
    state.value = res.value;
    return validateLimits(state.limits);
  };

  const run = (keepSelection: Train['stages'] | null = null) => {
    const err = readForm();
    formError.textContent = err ?? '';
    if (err) {
      parsed.textContent = '';
      return;
    }
    const x = state.value as number;
    parsed.textContent = `= ${x.toPrecision(12).replace(/\.?0+$/, '')}${x < 1 ? ' (step-up: the output turns faster than the input)' : ''}`;
    const t0 = performance.now();
    const result = searchTrains(x, state.limits);
    const ms = performance.now() - t0;
    state.trains = result.trains;
    state.bestByStages = result.bestByStages;
    state.selected = keepSelection ? makeTrain(keepSelection, x) : (state.trains[0] ?? null);
    summary.textContent = state.trains.length
      ? `Checked ${result.examined.toLocaleString('en-US')} near-miss trains in ${Math.round(ms)} ms. ` +
        (state.trains[0]?.error === 0 ? 'Exact trains exist; the simplest come first.' : 'No exact train in this range; best approximations first.')
      : 'No train fits these limits. Widen the tooth range or allow more stages.';
    renderBest();
    renderTable();
    renderCf(x);
    renderView();
  };

  const stagesText = (t: Train) => t.stages.map((s) => `${s.driver}→${s.driven}`).join('  ·  ');

  const renderBest = () => {
    bestCards.replaceChildren(
      ...state.bestByStages.map((t, i) =>
        t
          ? el(
              'button',
              { type: 'button', class: 'best' + (t === state.selected ? ' active' : '') },
              el('strong', {}, `Best ${i + 1}-stage`),
              el('span', { class: 'mono' }, stagesText(t)),
              el('span', {}, formatError(t.error)),
            )
          : el('div', { class: 'best empty' }, el('strong', {}, `${i + 1}-stage`), el('span', {}, 'none in range')),
      ),
    );
    [...bestCards.querySelectorAll('button')].forEach((b, i) => {
      const t = state.bestByStages.filter(Boolean)[i] as Train;
      b.addEventListener('click', () => select(t));
    });
  };

  const renderTable = () => {
    tableBody.replaceChildren(
      ...state.trains.map((t) => {
        const tr = el(
          'tr',
          { tabindex: '0', class: t === state.selected ? 'active' : '' },
          el('td', { class: 'mono' }, stagesText(t)),
          el('td', { class: 'mono' }, `${t.num.toLocaleString('en-US')}/${t.den.toLocaleString('en-US')}`),
          el('td', {}, formatError(t.error)),
          el('td', {}, formatSecondsPerDay(secondsPerDay(t))),
          el('td', {}, String(t.teeth)),
        );
        tr.addEventListener('click', () => select(t));
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(t);
          }
        });
        return tr;
      }),
    );
  };

  const renderCf = (x: number) => {
    const terms = continuedFraction(x, 24);
    const approx = convergents(terms)
      .filter((c) => c.p > 0 && c.q <= 1e6)
      .map((c) => ({ ...c, error: relError(c, x) }));
    const runs = sternBrocotRuns(terms);
    cfPanel.replaceChildren(
      el('p', {}, el('span', { class: 'mono' }, terms.length > 1 ? `[${terms[0]}; ${terms.slice(1).join(', ')}]` : `[${terms[0]}]`)),
      el(
        'p',
        {},
        'Stern-Brocot path from 1/1: ',
        el('span', { class: 'mono' }, formatRuns(runs)),
        el('span', { class: 'hint' }, ' (R = go right toward larger fractions, L = left; each run is one continued-fraction term)'),
      ),
      el(
        'div',
        // Focusable, so a keyboard can scroll it when it is wider than the screen.
        { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Convergents' },
        el(
          'table',
          { class: 'approx' },
          el(
            'thead',
            {},
            el('tr', {}, el('th', {}, 'Convergent'), el('th', {}, 'Error'), el('th', {}, 'Buildable?')),
          ),
          el(
            'tbody',
            {},
            ...approx.map((a) => {
              const k = buildableStages(a.p, a.q, state.limits);
              return el(
                'tr',
                {},
                el('td', { class: 'mono' }, `${a.p}/${a.q}`),
                el('td', {}, formatError(a.error)),
                el('td', { class: k ? 'good' : 'muted' }, k ? `yes, ${k} stage${k > 1 ? 's' : ''}` : 'no, not within these limits'),
              );
            }),
          ),
        ),
      ),
      el(
        'p',
        { class: 'hint' },
        'Each convergent is closer than every fraction with a smaller denominator, and the Stern-Brocot path passes through all of them. Brocot\'s insight: the best fraction is often unbuildable (a prime factor larger than any gear), and a slightly worse neighbour that factors into small numbers wins. The train search above does exactly that.',
      ),
    );
  };

  const renderView = () => {
    const t = state.selected;
    view.hidden = !t;
    if (!t) return;
    viewTitle.textContent = `Gear train: ${stagesText(t)}`;
    arbors = layoutTrain(t.stages, state.module);
    const out = arbors.at(-1) as Arbor;
    viewInfo.replaceChildren(
      `Reduction ${t.num.toLocaleString('en-US')}/${t.den.toLocaleString('en-US')} = ${t.ratio.toPrecision(10)}, error ${formatError(t.error)}, ${formatSecondsPerDay(secondsPerDay(t))} as a clock. `,
      `Output turns ${out.speed < 0 ? 'opposite to' : 'the same way as'} the input. Input arbor is outlined; output arbor carries the hand.`,
    );
    const b = trainBounds(arbors, state.module);
    const pad = state.module * 4;
    gearSvg.setAttribute('viewBox', `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`);
    gearNodes = [];
    const layers: SVGElement[] = [];
    arbors.forEach((a, ai) => {
      a.gears.forEach((g) => {
        const d = gearDims(g.teeth, state.module);
        const node = svg(
          'g',
          { class: `gear stage-${g.stage % 3} ${g.role}` },
          svg('path', { d: outlinePath(gearOutline(g.teeth, state.module), 0, 0, 2) }),
          svg('circle', { r: String(d.pitch), class: 'pitch' }),
          svg('line', { x1: '0', y1: '0', x2: String(d.root * 0.8), y2: '0', class: 'spoke' }),
        ) as SVGGElement;
        gearNodes.push({ node, arbor: a });
        // Driven gears sit behind the next stage's driver on the same arbor.
        layers.push(node);
      });
      const axle = svg('circle', { cx: String(a.x), cy: String(a.y), r: String(state.module * 1.2), class: ai === 0 ? 'axle input' : ai === arbors.length - 1 ? 'axle output' : 'axle' });
      layers.push(axle);
    });
    // Hand on the output arbor, rotating with it.
    const lastGear = gearNodes.at(-1);
    if (lastGear) {
      const r = gearDims(t.stages.at(-1)?.driven as number, state.module).outer;
      lastGear.node.append(svg('line', { x1: '0', y1: '0', x2: String(r * 1.25), y2: '0', class: 'hand' }));
      const bb = { minX: Math.min(b.minX, out.x - r * 1.3), maxX: Math.max(b.maxX, out.x + r * 1.3), minY: Math.min(b.minY, out.y - r * 1.3), maxY: Math.max(b.maxY, out.y + r * 1.3) };
      gearSvg.setAttribute('viewBox', `${bb.minX - pad} ${bb.minY - pad} ${bb.maxX - bb.minX + 2 * pad} ${bb.maxY - bb.minY + 2 * pad}`);
    }
    gearSvg.replaceChildren(...layers);
    drawRotation();
    renderDrift();
    renderBestActive();
  };

  const renderBestActive = () => {
    for (const tr of tableBody.querySelectorAll('tr')) tr.classList.remove('active');
    const i = state.trains.findIndex((t) => state.selected && encodeTrain(t.stages) === encodeTrain(state.selected.stages));
    if (i >= 0) tableBody.children[i]?.classList.add('active');
  };

  const renderDrift = () => {
    const t = state.selected;
    if (!t) return;
    const n = 10 ** (Number(driftInput.value) / 10); // 1 .. 1e8 output turns
    const ahead = turnsAhead(t, n);
    const frac = ahead - Math.floor(ahead);
    const angle = frac * 360;
    const hand = (deg: number, cls: string, len: number) => {
      const r = (deg - 90) * (Math.PI / 180);
      return svg('line', { x1: '0', y1: '0', x2: String(len * Math.cos(r)), y2: String(len * Math.sin(r)), class: cls });
    };
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const r = (i * 30 * Math.PI) / 180;
      return svg('line', { x1: String(92 * Math.sin(r)), y1: String(-92 * Math.cos(r)), x2: String(100 * Math.sin(r)), y2: String(-100 * Math.cos(r)), class: 'tick' });
    });
    dial.replaceChildren(svg('circle', { r: '100', class: 'face' }), ...ticks, hand(0, 'ideal', 85), hand(angle, 'actual', 85), svg('circle', { r: '4', class: 'hub' }));
    const deg = ahead * 360;
    const nText = n < 1e4 ? Math.round(n).toLocaleString('en-US') : n.toExponential(1);
    driftText.replaceChildren(
      el('strong', {}, `After ${nText} output turn${n === 1 ? '' : 's'}: `),
      t.error === 0
        ? 'still exactly together. This train is exact.'
        : `${ahead > 0 ? 'ahead' : 'behind'} by ${Math.abs(deg) < 360 ? `${Math.abs(deg).toPrecision(3)}°` : `${Math.abs(ahead).toPrecision(3)} turns`}.`,
      el('br'),
      t.error === 0
        ? ''
        : `If one output turn is a day, it ${formatSecondsPerDay(secondsPerDay(t))} and is a minute out after ${formatDuration(daysToDrift(t, 60))}. Rate error ${formatError(rateError(t))}.`,
    );
  };
  driftInput.addEventListener('input', renderDrift);

  const select = (t: Train) => {
    state.selected = t;
    renderView();
    renderBest();
    updateHash();
  };

  const updateHash = () => {
    const hash = encodeState({ target: state.target, limits: state.limits, module: state.module, train: state.selected?.stages ?? null });
    history.replaceState(null, '', `#${hash}`);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
    updateHash();
  });
  presetSelect.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === presetSelect.value);
    if (!p) return;
    targetInput.value = p.target;
    const l = { ...DEFAULT_LIMITS, ...p.limits };
    minInput.value = String(l.minTeeth);
    maxInput.value = String(l.maxTeeth);
    stagesInput.value = String(l.maxStages);
    note.textContent = p.note;
    run();
    updateHash();
  });
  moduleInput.addEventListener('change', () => {
    const m = Number(moduleInput.value);
    if (m > 0) {
      state.module = m;
      renderView();
      updateHash();
    }
  });

  shareBtn.addEventListener('click', async () => {
    updateHash();
    try {
      await navigator.clipboard.writeText(location.href);
      status.textContent = 'Link copied.';
    } catch {
      status.textContent = 'Copy the address bar to share.';
    }
  });
  cutBtn.addEventListener('click', () => {
    if (!state.selected) return;
    const text = cutSheet(state.selected.stages, { module: state.module, bore: Math.max(3, state.module * 2.5), gap: 5 });
    const a = el('a', {
      href: URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })),
      download: `gears-${encodeTrain(state.selected.stages)}-m${state.module}.svg`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status.textContent = 'SVG downloaded (red = cut, blue = engrave).';
  });

  run(shared?.train ?? null);
}
