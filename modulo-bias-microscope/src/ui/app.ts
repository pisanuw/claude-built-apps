import { GALLERY, galleryEntry, type GalleryEntry } from '../core/gallery';
import { aBits, validateExercise, type Exercise, type GradeResult } from '../core/grade';
import type { JobResponse } from '../core/jobs';
import { decodeWorkspace, encodeWorkspace, type Workspace } from '../core/permalink';
import { format, toNumber } from '../core/rational';
import { histogramFromExact, histogramFromSample, positionMatrix, type ExactReport } from '../core/report';
import type { ExactDistribution } from '../core/exact';
import type { ChiSquare, StatSample } from '../core/stats';
import { describeTarget, parseWeightLines, targetDistribution, type TargetSpec } from '../core/target';
import { heatmap, histogram, pctLabel } from './charts';
import { clear, field, h, numberInput, select } from './dom';
import { run } from './runner';

interface State {
  code: string;
  argsText: string;
  target: TargetSpec;
  bits: number;
  draws: number;
  seed: number;
  gallery: GalleryEntry | null;
  showingFix: boolean;
  exercise: Exercise | null;
}

const TABLE_ROWS = 200;

function fromEntry(g: GalleryEntry): State {
  return {
    code: g.broken,
    argsText: JSON.stringify(g.args),
    target: g.target,
    bits: g.bits,
    draws: 200_000,
    seed: 1,
    gallery: g,
    showingFix: false,
    exercise: null,
  };
}

function fromHash(): State | null {
  const g = /[#&]g=([a-z-]+)/.exec(location.hash);
  const entry = g ? galleryEntry(g[1]) : undefined;
  if (entry) return fromEntry(entry);
  const m = /[#&]w=([A-Za-z0-9_-]+)/.exec(location.hash);
  const w = m ? decodeWorkspace(m[1]) : null;
  if (!w) return null;
  return {
    code: w.code,
    argsText: JSON.stringify(w.args),
    target: w.target,
    bits: w.bits,
    draws: w.draws,
    seed: 1,
    gallery: null,
    showingFix: false,
    exercise: w.exercise ?? null,
  };
}

export function mountApp(root: HTMLElement): void {
  clear(root);
  const st: State = fromHash() ?? fromEntry(GALLERY[0]);

  const results = h('section', { class: 'panel results', 'aria-live': 'polite' });
  const status = h('p', { class: 'status' });
  const editor = h('textarea', { class: 'code', spellcheck: 'false', autocapitalize: 'off', rows: 16, 'aria-label': 'Sampler source code' });
  editor.value = st.code;
  editor.addEventListener('input', () => (st.code = editor.value));
  editor.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || ev.shiftKey) return;
    ev.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    st.code = editor.value;
  });
  const argsInput = h('input', { type: 'text', class: 'mono', value: st.argsText, 'aria-label': 'Arguments as a JSON array' });
  argsInput.addEventListener('input', () => (st.argsText = argsInput.value));

  // ---- header ------------------------------------------------------------
  root.append(
    h(
      'header',
      { class: 'site-header' },
      h('h1', {}, h('span', { class: 'logo', 'aria-hidden': 'true' }, '%'), 'Modulo Bias Microscope'),
      h(
        'p',
        { class: 'lede' },
        'Paste a sampling function and see how far its output drifts from the distribution you meant. ',
        h('strong', {}, 'Exact mode'),
        ' runs it on every value of a tiny random source and reports each probability as a fraction; ',
        h('strong', {}, 'statistical mode'),
        ' draws hundreds of thousands of times from a 32-bit source and runs a chi-square test.',
      ),
    ),
  );

  // ---- exercise banner ---------------------------------------------------
  if (st.exercise) {
    const ex = st.exercise;
    root.append(
      h(
        'section',
        { class: 'panel exercise' },
        h('p', { class: 'eyebrow' }, 'Exercise'),
        h('h2', {}, ex.title),
        h('p', {}, ex.prompt),
        h(
          'p',
          { class: 'muted' },
          `Target: ${describeTarget(ex.target)}. Called as sample(rng, ${ex.args.map((a) => JSON.stringify(a)).join(', ')}). `,
          ex.allowBelow ? 'rng.below(k) is allowed.' : 'rng.below(k) is turned off: build it from rng.next() or rng.random().',
          ` Graded exactly on ${aBits(ex.bits)} source when that is feasible, otherwise by a chi-square test that fails a correct answer ${pctLabel(ex.alpha)} of the time.`,
        ),
        h('a', { href: location.pathname, class: 'small-link' }, 'Leave the exercise and open the bug gallery'),
      ),
    );
  }

  // ---- gallery -----------------------------------------------------------
  const explain = h('div', { class: 'explain' });
  const chips = h('div', { class: 'chips', role: 'list' });
  const renderGallery = (): void => {
    clear(chips);
    for (const g of GALLERY) {
      chips.append(
        h(
          'button',
          {
            type: 'button',
            role: 'listitem',
            class: st.gallery?.id === g.id ? 'chip active' : 'chip',
            'aria-pressed': String(st.gallery?.id === g.id),
            onclick: () => {
              Object.assign(st, fromEntry(g));
              syncInputs();
              renderGallery();
              void runExact();
            },
          },
          g.title,
        ),
      );
    }
    clear(explain);
    const g = st.gallery;
    if (!g) {
      explain.append(h('p', { class: 'muted' }, 'Pick a classic randomness bug above, or write your own sampler below.'));
      return;
    }
    explain.append(
      h('h3', {}, st.showingFix ? `Fixed with ${g.fixName}` : g.bug),
      h('p', {}, g.explanation),
      h(
        'button',
        {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            st.showingFix = !st.showingFix;
            st.code = st.showingFix ? g.fixed : g.broken;
            editor.value = st.code;
            renderGallery();
            void runExact();
          },
        },
        st.showingFix ? 'Show the broken version' : `Show the fix (${g.fixName})`,
      ),
    );
  };
  if (!st.exercise) {
    renderGallery();
    root.append(h('section', { class: 'panel gallery' }, h('h2', {}, 'Bug gallery'), chips, explain));
  }

  // ---- target editor -----------------------------------------------------
  const targetBox = h('div', { class: 'target-box' });
  const targetErr = h('p', { class: 'error-text', role: 'alert' });
  const locked = !!st.exercise;
  let weightsText = st.target.kind === 'weights' ? st.target.entries.map(([k, w]) => `${k}: ${w}`).join('\n') : '"heads": 1\n"tails": 1';
  const renderTarget = (): void => {
    clear(targetBox);
    const t = st.target;
    const kind = select(
      [
        { value: 'uniform-int', label: 'Uniform integers' },
        { value: 'permutations', label: 'Uniform permutations' },
        { value: 'weights', label: 'Weighted outcomes' },
      ] as const,
      t.kind,
      (v) => {
        st.target =
          v === 'uniform-int' ? { kind: v, n: 6 } : v === 'permutations' ? { kind: v, n: 3 } : { kind: v, entries: parseSafe(weightsText) };
        renderTarget();
      },
      { disabled: locked },
    );
    targetBox.append(field('Intended distribution', kind));
    if (t.kind === 'uniform-int') {
      targetBox.append(
        h(
          'div',
          { class: 'row' },
          field('How many values (n)', numberInput(t.n, 1, (v) => ((st.target = { ...t, n: v }), checkTarget()), { min: 1, disabled: locked })),
          field('Starting at', numberInput(t.offset ?? 0, 1, (v) => ((st.target = { ...t, offset: v }), checkTarget()), { disabled: locked })),
        ),
      );
    } else if (t.kind === 'permutations') {
      targetBox.append(field('Items 0…n−1 (n ≤ 7)', numberInput(t.n, 1, (v) => ((st.target = { ...t, n: v }), checkTarget()), { min: 1, max: 7, disabled: locked })));
    } else {
      const ta = h('textarea', { class: 'mono', rows: 4, disabled: locked, 'aria-label': 'Weights, one "outcome: weight" per line' });
      ta.value = weightsText;
      ta.addEventListener('input', () => {
        weightsText = ta.value;
        st.target = { kind: 'weights', entries: parseSafe(weightsText) };
        checkTarget();
      });
      targetBox.append(field('One "outcome: weight" per line', ta, 'Outcomes are JSON: quote strings ("red"); weights may be 3, 0.25 or 1/3.'));
    }
    targetBox.append(targetErr);
    checkTarget();
  };
  const parseSafe = (text: string): [string, string][] => {
    try {
      return parseWeightLines(text);
    } catch {
      return [];
    }
  };
  const checkTarget = (): boolean => {
    try {
      if (st.target.kind === 'weights') parseWeightLines(weightsText);
      targetDistribution(st.target);
      targetErr.textContent = '';
      return true;
    } catch (e) {
      targetErr.textContent = (e as Error).message;
      return false;
    }
  };

  // ---- settings and actions ---------------------------------------------
  const bitsInput = numberInput(st.bits, 1, (v) => (st.bits = v), { min: 1, max: 16 });
  const drawsInput = numberInput(st.draws, 10000, (v) => (st.draws = v), { min: 1000, max: 5000000 });
  const seedInput = numberInput(st.seed, 1, (v) => (st.seed = v), { min: 0 });
  const syncInputs = (): void => {
    editor.value = st.code;
    argsInput.value = st.argsText;
    bitsInput.value = String(st.bits);
    drawsInput.value = String(st.draws);
    if (st.target.kind === 'weights') weightsText = st.target.entries.map(([k, w]) => `${k}: ${w}`).join('\n');
    renderTarget();
  };

  const parseArgs = (): unknown[] | null => {
    try {
      const v: unknown = JSON.parse(st.argsText);
      if (!Array.isArray(v)) throw new Error('not an array');
      return v;
    } catch {
      showError('Arguments must be a JSON array, for example [6] or [["a","b"], [1, 2]].');
      return null;
    }
  };

  const busy = (label: string): void => {
    status.textContent = label;
    root.classList.add('is-busy');
  };
  const idle = (): void => {
    status.textContent = '';
    root.classList.remove('is-busy');
  };
  let ticket = 0;
  const showError = (msg: string): void => {
    idle();
    clear(results);
    results.append(h('div', { class: 'verdict bad' }, h('strong', {}, 'Could not run'), h('p', {}, msg)));
  };

  const allowBelow = (): boolean => st.exercise?.allowBelow ?? true;

  const runExact = async (): Promise<void> => {
    const args = parseArgs();
    if (!args || !checkTarget()) return;
    const my = ++ticket;
    busy(`Enumerating every draw from ${aBits(st.bits)} source…`);
    const res = await run({ kind: 'exact', code: st.code, args, target: st.target, bits: st.bits, allowBelow: allowBelow() });
    if (my !== ticket) return;
    idle();
    renderResponse(res);
  };
  const runStat = async (): Promise<void> => {
    const args = parseArgs();
    if (!args || !checkTarget()) return;
    const my = ++ticket;
    busy(`Drawing ${st.draws.toLocaleString('en-US')} samples…`);
    const res = await run({ kind: 'stat', code: st.code, args, target: st.target, draws: st.draws, seed: st.seed, allowBelow: allowBelow() }, (d) => {
      if (my === ticket) status.textContent = `Drawing samples… ${d.toLocaleString('en-US')} of ${st.draws.toLocaleString('en-US')}`;
    });
    if (my !== ticket) return;
    idle();
    renderResponse(res);
  };
  const runGrade = async (): Promise<void> => {
    if (!st.exercise) return;
    const my = ++ticket;
    busy('Grading…');
    const res = await run({ kind: 'grade', code: st.code, exercise: st.exercise });
    if (my !== ticket) return;
    idle();
    renderResponse(res);
  };

  const shareOut = h('p', { class: 'share-out' });
  const share = (): void => {
    const args = parseArgs();
    if (!args) return;
    const w: Workspace = { code: st.code, args, target: st.target, bits: st.bits, draws: st.draws };
    if (st.exercise) w.exercise = st.exercise;
    const url = `${location.origin}${location.pathname}#w=${encodeWorkspace(w)}`;
    history.replaceState(null, '', url);
    copy(url, shareOut, 'Link to this code copied. Paste it into a forum post or the office-hours queue.');
  };

  const actions = h(
    'div',
    { class: 'actions' },
    st.exercise ? h('button', { type: 'button', class: 'primary', onclick: () => void runGrade() }, 'Grade my sampler') : null,
    h('button', { type: 'button', class: st.exercise ? 'secondary' : 'primary', onclick: () => void runExact() }, 'Exact analysis'),
    h('button', { type: 'button', class: 'secondary', onclick: () => void runStat() }, 'Statistical test'),
    h('button', { type: 'button', class: 'ghost', onclick: share }, 'Copy link'),
  );

  const apiHelp = h(
    'details',
    { class: 'api' },
    h('summary', {}, 'What can the sampler call?'),
    h(
      'ul',
      {},
      h('li', {}, h('code', {}, 'rng.next()'), ' – a uniform integer in 0 … 2', h('sup', {}, 'bits'), ' − 1'),
      h('li', {}, h('code', {}, 'rng.random()'), ' – next() / 2', h('sup', {}, 'bits'), ', a float in [0, 1)'),
      h('li', {}, h('code', {}, 'rng.below(k)'), ' – an ideal uniform integer in 0 … k − 1 (exercises may turn it off)'),
      h('li', {}, h('code', {}, 'rng.bits'), ' – the source width: your choice in exact mode, 32 in statistical mode'),
    ),
    h(
      'p',
      { class: 'muted' },
      'Math.random() is blocked, and the function must not keep state between calls, because exact mode replays it once per draw sequence. The code runs in a Web Worker that is stopped after 30 seconds.',
    ),
  );

  renderTarget();
  root.append(
    h(
      'div',
      { class: 'workspace' },
      h(
        'section',
        { class: 'panel editor' },
        h('h2', {}, 'Your sampler'),
        editor,
        apiHelp,
        field('Arguments after rng (JSON array)', argsInput),
        targetBox,
        h(
          'div',
          { class: 'row' },
          field('Exact: source bits', bitsInput, '8 bits = 256 values per draw'),
          field('Statistical: draws', drawsInput),
          field('Seed', seedInput),
        ),
        actions,
        status,
        shareOut,
      ),
      results,
    ),
  );

  // ---- instructor ----------------------------------------------------------
  if (!st.exercise) root.append(instructorPanel(st, parseArgs, checkTarget));

  // ---- results -------------------------------------------------------------
  const renderResponse = (res: JobResponse): void => {
    clear(results);
    if (res.kind === 'error') {
      showError(res.message);
      return;
    }
    if (res.kind === 'grade') {
      results.append(gradeView(res.result));
      return;
    }
    if (res.kind === 'exact') {
      if (!res.result.ok || !res.report) {
        results.append(
          h('div', { class: 'verdict warn' }, h('strong', {}, res.result.ok ? 'No report' : 'Exact mode gave up'), h('p', {}, res.result.ok ? '' : res.result.message)),
        );
        return;
      }
      results.append(...exactView(res.result, res.report, st));
      return;
    }
    results.append(...statView(res.sample, res.chi, st));
  };

  void (st.exercise ? Promise.resolve() : runExact());
  if (st.exercise) {
    results.append(h('p', { class: 'muted' }, 'Edit the starter code, then press “Grade my sampler”. Exact analysis and the statistical test show the details.'));
  }
}

function copy(text: string, out: HTMLElement, done: string): void {
  clear(out);
  const fallback = (): void => {
    out.append('Copy this link: ', h('input', { type: 'text', readonly: true, value: text, class: 'mono', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }));
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => out.append(done), fallback);
  } else fallback();
}

function exactView(dist: ExactDistribution, r: ExactReport, st: State): HTMLElement[] {
  const cut = r.unresolved.n > 0n;
  const verdict = r.exactMatch
    ? h(
        'div',
        { class: 'verdict good' },
        h('strong', {}, 'Exactly right'),
        h(
          'p',
          {},
          `Every outcome has exactly its target probability on ${aBits(dist.bits)} source`,
          cut ? `, given that the sampler returns. Paths still looping after the cut-off carry ${format(r.unresolved)} of the probability.` : '.',
        ),
      )
    : h(
        'div',
        { class: 'verdict bad' },
        h('strong', {}, `Biased: off by ${format(r.conditionalTv)}`),
        h(
          'p',
          {},
          `Total variation distance from the target on ${aBits(dist.bits)} source${cut ? ' (given that it returns)' : ''}: the share of probability that sits on the wrong outcomes. `,
          r.missing.length ? `Never returns ${list(r.missing)}. ` : '',
          r.unexpected.length ? `Returns ${list(r.unexpected)}, which the target never does. ` : '',
        ),
      );
  const facts = h(
    'dl',
    { class: 'facts' },
    fact('Runs', dist.runs.toLocaleString('en-US')),
    fact('Longest draw sequence', String(dist.longestPath)),
    fact('Source', `${dist.bits} bits (${(2 ** dist.bits).toLocaleString('en-US')} values)`),
    fact('Cut off', cut ? format(r.unresolved) : 'nothing'),
  );
  const out: HTMLElement[] = [verdict, facts];
  if (r.errors.length) {
    out.push(
      h(
        'div',
        { class: 'verdict warn' },
        h('strong', {}, 'Throws'),
        h('ul', {}, ...r.errors.map(([m, p]) => h('li', {}, `${m} — probability ${format(p)}`))),
      ),
    );
  }
  out.push(histogram(histogramFromExact(r), 'Exact probability of each outcome against the target'));
  const probs = new Map(r.rows.map((row) => [row.key, toNumber(row.given)]));
  const pm = positionMatrix(probs, targetDistribution(st.target));
  if (pm) out.push(heatmap(pm));
  const rows = r.rows.slice(0, TABLE_ROWS);
  const table = h(
    'table',
    { class: 'grid-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Outcome'),
        h('th', { scope: 'col' }, 'Exact probability'),
        cut ? h('th', { scope: 'col' }, 'Given it returns') : null,
        h('th', { scope: 'col' }, 'Target'),
        h('th', { scope: 'col' }, 'Error'),
        h('th', { scope: 'col' }, 'Ratio'),
        h('th', { scope: 'col' }, 'One way to get it'),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((row) =>
        h(
          'tr',
          { class: row.error.n === 0n ? '' : row.error.n > 0n ? 'over' : 'under' },
          h('td', { class: 'mono' }, row.key),
          h('td', { class: 'mono' }, format(row.actual)),
          cut ? h('td', { class: 'mono' }, format(row.given)) : null,
          h('td', { class: 'mono' }, format(row.target)),
          h('td', { class: 'mono' }, row.error.n > 0n ? `+${format(row.error)}` : format(row.error)),
          h('td', { class: 'mono' }, Number.isFinite(row.ratio) ? row.ratio.toFixed(4) : '∞'),
          h('td', { class: 'mono small' }, witness(dist.witness.get(row.key))),
        ),
      ),
    ),
  );
  out.push(
    h(
      'details',
      { class: 'table-wrap', open: r.rows.length <= 40 },
      h('summary', {}, `Every outcome (${r.rows.length.toLocaleString('en-US')})`),
      h('div', { class: 'table-scroll' }, table),
      r.rows.length > TABLE_ROWS ? h('p', { class: 'muted' }, `First ${TABLE_ROWS} rows shown.`) : null,
    ),
  );
  if (!r.exactMatch && !r.errors.length && !r.unexpected.length && r.tv.n > 0n) {
    out.push(
      h(
        'p',
        { class: 'note' },
        'Try the statistical test too. A bias that comes from the narrow source (modulo, scaling) shrinks to about one part in 2^32 on a 32-bit source and vanishes from any histogram, though it is still there; a bias in the algorithm itself (shuffles, ranges, weights) stays the same size and shows up clearly.',
      ),
    );
  }
  return out;
}

function witness(path: number[] | undefined): string {
  if (!path) return '';
  if (path.length === 0) return 'no draws';
  const s = path.slice(0, 8).join(', ');
  return `draws ${s}${path.length > 8 ? ', …' : ''}`;
}

function list(keys: string[]): string {
  return keys.length <= 4 ? keys.join(', ') : `${keys.slice(0, 4).join(', ')} and ${keys.length - 4} more`;
}

function fact(label: string, value: string): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

function statView(sample: StatSample, chi: ChiSquare, st: State): HTMLElement[] {
  const target = targetDistribution(st.target);
  const pass = chi.pValue >= 0.01;
  const verdict = h(
    'div',
    { class: `verdict ${pass ? 'good' : 'bad'}` },
    h('strong', {}, pass ? 'No bias detected' : 'Biased'),
    h(
      'p',
      {},
      `χ² = ${chi.statistic.toFixed(2)} with ${chi.df} degrees of freedom, p = ${chi.pValue === 0 ? '0' : chi.pValue.toPrecision(3)}. `,
      pass
        ? `A test at 1% would accept this. That does not mean it is exact: a bias smaller than about ${pctLabel(3 / Math.sqrt(sample.draws))} per outcome is invisible at ${sample.draws.toLocaleString('en-US')} draws.`
        : 'A correct sampler would produce counts this far off less than 1% of the time.',
      chi.unexpected.length ? ` Produced ${list(chi.unexpected)}, which the target never does.` : '',
    ),
  );
  const out: HTMLElement[] = [
    verdict,
    h(
      'dl',
      { class: 'facts' },
      fact('Draws', sample.draws.toLocaleString('en-US')),
      fact('Distinct outcomes', sample.counts.size.toLocaleString('en-US')),
      fact('Seed', String(sample.seed)),
      fact('Thin cells', chi.sparseCells ? `${chi.sparseCells} expect < 5` : 'none'),
    ),
  ];
  if (sample.errors.size) {
    out.push(
      h(
        'div',
        { class: 'verdict warn' },
        h('strong', {}, 'Throws'),
        h('ul', {}, ...[...sample.errors].map(([m, c]) => h('li', {}, `${m} — ${c.toLocaleString('en-US')} times`))),
      ),
    );
  }
  const bars = histogramFromSample(sample, target);
  out.push(histogram(bars, 'Observed frequency of each outcome against the target'));
  const probs = new Map([...sample.counts].map(([k, c]) => [k, c / sample.draws]));
  const pm = positionMatrix(probs, target);
  if (pm) out.push(heatmap(pm));
  const rows = bars.slice(0, TABLE_ROWS);
  out.push(
    h(
      'details',
      { class: 'table-wrap', open: bars.length <= 40 },
      h('summary', {}, `Every outcome (${bars.length.toLocaleString('en-US')})`),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'grid-table' },
          h(
            'thead',
            {},
            h('tr', {}, ...['Outcome', 'Count', 'Expected', 'Observed', 'Target', 'z'].map((c) => h('th', { scope: 'col' }, c))),
          ),
          h(
            'tbody',
            {},
            ...rows.map((b) => {
              const c = sample.counts.get(b.key) ?? 0;
              const e = b.target * sample.draws;
              const z = e > 0 ? (c - e) / Math.sqrt(e * (1 - b.target)) : Infinity;
              return h(
                'tr',
                { class: Math.abs(z) > 3 ? (z > 0 ? 'over' : 'under') : '' },
                h('td', { class: 'mono' }, b.key),
                h('td', { class: 'mono' }, c.toLocaleString('en-US')),
                h('td', { class: 'mono' }, e.toFixed(1)),
                h('td', { class: 'mono' }, pctLabel(b.actual)),
                h('td', { class: 'mono' }, pctLabel(b.target)),
                h('td', { class: 'mono' }, Number.isFinite(z) ? z.toFixed(2) : '∞'),
              );
            }),
          ),
        ),
      ),
    ),
  );
  return out;
}

function gradeView(g: GradeResult): HTMLElement {
  return h(
    'div',
    { class: `verdict ${g.pass ? 'good' : 'bad'}` },
    h('strong', {}, g.pass ? 'Pass' : 'Not yet'),
    h('p', {}, g.summary),
    g.details.length ? h('ul', {}, ...g.details.map((d) => h('li', {}, d))) : null,
    h(
      'p',
      { class: 'muted' },
      g.mode === 'exact'
        ? 'Graded exactly: a correct sampler always passes and a biased one always fails.'
        : `Graded statistically: a correct sampler fails ${pctLabel(g.falseFailRate)} of the time, and biases smaller than the test can resolve pass.`,
    ),
  );
}

function instructorPanel(st: State, parseArgs: () => unknown[] | null, checkTarget: () => boolean): HTMLElement {
  const title = h('input', { type: 'text', value: 'Fair die from raw bits', 'aria-label': 'Exercise title' });
  const prompt = h('textarea', { rows: 3, 'aria-label': 'Exercise prompt' });
  prompt.value = 'Write sample(rng, n) so that every value 0 … n−1 is exactly equally likely, using only rng.next().';
  const alpha = h('input', { type: 'number', value: '0.01', step: '0.005', min: '0.001', max: '0.2' });
  const below = h('input', { type: 'checkbox' });
  const out = h('div', { class: 'share-out' });
  const make = (): void => {
    clear(out);
    const args = parseArgs();
    if (!args || !checkTarget()) return;
    const ex: Exercise = {
      title: title.value.trim(),
      prompt: prompt.value.trim(),
      args,
      target: st.target,
      alpha: Number(alpha.value),
      bits: st.bits,
      draws: st.draws,
      allowBelow: below.checked,
      starter: st.code,
    };
    const problems = validateExercise(ex);
    if (problems.length) {
      out.append(h('ul', { class: 'error-text' }, ...problems.map((p) => h('li', {}, p))));
      return;
    }
    const w: Workspace = { code: ex.starter, args, target: ex.target, bits: ex.bits, draws: ex.draws, exercise: ex };
    const url = `${location.origin}${location.pathname}#w=${encodeWorkspace(w)}`;
    out.append(h('p', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open the exercise'), ' (opens in a new tab). '));
    const msg = h('span');
    out.append(msg);
    copy(url, msg, 'Link copied.');
  };
  return h(
    'section',
    { class: 'panel instructor' },
    h('h2', {}, 'Make an exercise'),
    h(
      'p',
      { class: 'muted' },
      'The exercise uses the arguments, target, source bits, draws and code in the editor above (the code becomes the starter). Students get a link; grading runs in their browser, so nothing is stored anywhere.',
    ),
    h('div', { class: 'row' }, field('Title', title), field('False-fail rate for the statistical fallback', alpha, '0.01 = a correct sampler fails 1 time in 100.')),
    field('Prompt', prompt),
    h('label', { class: 'check' }, below, ' Allow rng.below(k) (leave off when the point is to build it)'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: make }, 'Create exercise link')),
    out,
  );
}
