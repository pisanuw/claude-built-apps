// Challenge mode: a board with one hidden fault, free runs of test programs,
// a limited probe budget, the consistent-fault set and a final answer.

import { TIERS, encodeChallenge, grade, type Challenge, type Verdict } from '../core/challenge';
import { FREE_SIGNAL, type Observation } from '../core/diagnosis';
import { CATALOG, KIND_TITLES, describeFault, faultChip, faultKey, type Fault, type FaultKind } from '../core/faults';
import { AsmError, TEST_PROGRAMS, assemble, type Program } from '../core/isa';
import { NET_COUNT, NETS, PINS, signalName, signalOfPin } from '../core/netlist';
import { DEFAULT_MAX_CYCLES, simulate, type RunResult } from '../core/sim';
import { Analyzer } from './analyzer';
import { saveAttempt } from './attempts';
import { Board } from './board';
import { button, clear, el, rebuild, select } from './dom';
import { FaultPicker } from './faultPicker';
import type { SignatureService } from './signatures';

interface Run {
  readonly id: number;
  readonly program: Program;
  readonly result: RunResult;
  readonly healthy: RunResult;
}

interface Probe {
  readonly run: number;
  readonly signal: number;
}

const CUSTOM_TEMPLATE = `; your own test program (16 bytes max)
      LDI 3
      OUT
      HLT`;

export function faultSignals(f: Fault): Set<number> {
  switch (f.kind) {
    case 'stuck': return new Set([f.net]);
    case 'open': return new Set([signalOfPin(f.pin)]);
    case 'short': return new Set([f.a, f.b]);
    default: return new Set();
  }
}

export class ChallengeView {
  readonly root = el('section', { class: 'view challenge' });
  private runs: Run[] = [];
  private probes: Probe[] = [];
  private current: number | null = null;
  private cursor = 0;
  private selected: number | null = null;
  private programChoice = '0';
  private customSource = CUSTOM_TEMPLATE;
  private customCount = 0;
  private finished: { verdict: Verdict; answer: Fault } | null = null;
  private showSet = true;
  private hint: string | null = null;
  private asmError: string | null = null;
  private readonly openKinds = new Set<FaultKind>();

  private readonly board = new Board((s) => this.pick(s));
  private readonly analyzer = new Analyzer((c) => {
    this.cursor = c;
    this.render();
  });
  private readonly picker = new FaultPicker(() => {});
  private readonly side = el('div', { class: 'side' });
  private readonly bar = el('div', { class: 'bar' });

  constructor(
    private readonly challenge: Challenge,
    private readonly sigs: SignatureService,
    private readonly onNew: (tier: Challenge['tier']) => void,
  ) {
    this.root.append(
      this.bar,
      el('div', { class: 'layout' }, el('div', { class: 'card board-card' }, this.board.root), this.side),
      el('div', { class: 'card' }, el('h2', {}, 'Logic analyzer'), this.analyzer.root),
    );
    sigs.onProgress = () => {
      // Do not rebuild the panel under someone typing a program.
      if (!(document.activeElement instanceof HTMLTextAreaElement && this.side.contains(document.activeElement))) this.renderSide();
    };
    for (const p of TEST_PROGRAMS) void sigs.ensure(p.bytes);
    this.render();
  }

  get code(): string {
    return encodeChallenge(this.challenge);
  }

  private get probesLeft(): number {
    return this.challenge.budget - this.probes.length;
  }

  private get run(): Run | null {
    return this.runs.find((r) => r.id === this.current) ?? null;
  }

  private pick(signal: number) {
    this.selected = signal;
    this.picker.focusSignal(signal < NET_COUNT ? signal : PINS[signal - NET_COUNT].net, signal >= NET_COUNT ? signal - NET_COUNT : null);
    this.render();
  }

  private doRun() {
    let program: Program;
    if (this.programChoice === 'custom') {
      try {
        program = { name: `Custom ${++this.customCount}`, source: this.customSource, bytes: assemble(this.customSource) };
        this.asmError = null;
      } catch (e) {
        this.asmError = e instanceof AsmError ? e.message : String(e);
        this.render();
        return;
      }
    } else {
      program = TEST_PROGRAMS[Number(this.programChoice)];
    }
    const result = simulate(program.bytes, this.challenge.fault, { record: true });
    const healthy = simulate(program.bytes, null);
    const id = this.runs.length;
    this.runs.push({ id, program, result, healthy });
    this.current = id;
    this.cursor = 0;
    this.hint = null;
    void this.sigs.ensure(program.bytes);
    this.render();
  }

  private probe() {
    const run = this.run;
    if (!run || this.selected === null || this.finished) return;
    if (this.probes.some((p) => p.run === run.id && p.signal === this.selected)) return;
    if (this.probesLeft <= 0) return;
    this.probes.push({ run: run.id, signal: this.selected });
    this.hint = null;
    this.render();
  }

  private observations(): Observation[] {
    const obs: Observation[] = this.runs.map((r) => ({ bytes: r.program.bytes, signal: FREE_SIGNAL, hash: r.result.hashes[FREE_SIGNAL] }));
    for (const p of this.probes) {
      const r = this.runs[p.run];
      obs.push({ bytes: r.program.bytes, signal: p.signal, hash: r.result.hashes[p.signal] });
    }
    return obs;
  }

  private submit() {
    const answer = this.picker.fault;
    if (!answer || this.finished) return;
    const verdict = grade(answer, this.challenge.fault);
    this.finished = { verdict, answer };
    saveAttempt({
      when: new Date().toISOString(),
      tier: this.challenge.tier,
      code: this.code,
      answer: faultKey(answer),
      truth: faultKey(this.challenge.fault),
      verdict,
      probesUsed: this.probes.length,
      runs: this.runs.length,
    });
    this.render();
  }

  render(): void {
    this.renderBar();
    this.renderBoard();
    this.renderSide();
    this.renderAnalyzer();
  }

  private renderBar() {
    clear(this.bar);
    const t = TIERS[this.challenge.tier];
    this.bar.append(
      this.challenge.seed === null
        ? el('div', {}, el('strong', {}, 'Instructor challenge'), el('span', { class: 'muted' }, ' Any kind of fault, chosen by hand.'))
        : el('div', {}, el('strong', {}, t.title), el('span', { class: 'muted' }, ` ${t.blurb}`)),
      el('div', { class: `budget ${this.probesLeft === 0 ? 'out' : ''}` }, `Probes left: ${this.probesLeft} / ${this.challenge.budget}`),
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'muted small' }, 'New:'),
        ...(Object.keys(TIERS) as Challenge['tier'][]).map((tier) => button(TIERS[tier].title.split(' ')[0], () => this.onNew(tier), 'small')),
      ),
    );
  }

  private renderBoard() {
    const run = this.run;
    const rec = run?.result.records?.[Math.min(this.cursor, run.result.cycles - 1)];
    const known = new Set(this.probes.filter((p) => p.run === this.current).map((p) => p.signal));
    this.board.update({
      value: (s) => (rec && (this.finished || known.has(s)) ? rec.values[s] : undefined),
      selected: this.selected,
      faultSignals: this.finished ? faultSignals(this.challenge.fault) : undefined,
      faultChip: this.finished ? faultChip(this.challenge.fault) : null,
    });
  }

  private renderAnalyzer() {
    const run = this.run;
    if (!run) {
      this.analyzer.render([], 0, 0);
      return;
    }
    const rows = this.probes
      .filter((p) => p.run === run.id)
      .map((p) => ({
        label: signalName(p.signal),
        values: run.result.records!.map((c) => c.values[p.signal]),
      }));
    this.analyzer.render(rows, run.result.cycles, this.cursor);
  }

  private renderSide() {
    rebuild(this.side, () => [this.runCard(), this.probeCard(), this.diagnosisCard(), this.answerCard()]);
  }

  private runCard(): HTMLElement {
    const options: [string, string][] = TEST_PROGRAMS.map((p, i) => [`${i}`, p.name]);
    options.push(['custom', 'Write your own…']);
    const card = el(
      'div',
      { class: 'card' },
      el('h2', {}, '1. Run a test program'),
      el('p', { class: 'muted small' }, 'Free. You see the output display, as anyone at the bench would.'),
      el(
        'div',
        { class: 'row' },
        select(options, this.programChoice, (v) => {
          this.programChoice = v;
          this.renderSide();
        }),
        button('Run', () => this.doRun(), 'primary'),
      ),
    );
    if (this.programChoice === 'custom') {
      const ta = el('textarea', { rows: '6', spellcheck: 'false', class: 'mono' });
      ta.value = this.customSource;
      ta.addEventListener('input', () => (this.customSource = ta.value));
      card.append(ta);
      card.append(el('p', { class: 'muted small' }, 'NOP LDA ADD SUB STA LDI JMP JC JZ OUT HLT, DB n, ORG n, labels with "name:".'));
    } else {
      card.append(el('pre', { class: 'src' }, TEST_PROGRAMS[Number(this.programChoice)].source));
    }
    if (this.asmError) card.append(el('p', { class: 'bad small' }, this.asmError));
    if (this.runs.length) {
      const list = el('div', { class: 'runs' });
      for (const r of this.runs) {
        const b = button(r.program.name, () => {
          this.current = r.id;
          this.cursor = 0;
          this.render();
        }, r.id === this.current ? 'run active' : 'run');
        list.append(b);
      }
      card.append(el('div', { class: 'muted small' }, 'Runs (pick one to probe):'), list);
    }
    const run = this.run;
    if (run) card.append(displayPanel(run.result, run.healthy));
    return card;
  }

  private probeCard(): HTMLElement {
    const run = this.run;
    const card = el('div', { class: 'card' }, el('h2', {}, '2. Probe a pin or net'));
    card.append(el('p', { class: 'muted small' }, 'Click a pin or a bus line on the board, then capture its waveform for the selected run. Each capture costs one probe.'));
    const target = this.selected === null ? 'nothing selected' : signalName(this.selected);
    const already = run && this.selected !== null && this.probes.some((p) => p.run === run.id && p.signal === this.selected);
    const b = button(already ? 'Already captured' : `Probe ${target}`, () => this.probe(), 'primary');
    b.disabled = !run || this.selected === null || !!already || this.probesLeft <= 0 || !!this.finished;
    const nets = select(
      [['', 'or pick a net…'], ...NETS.map((n, i): [string, string] => [`${i}`, `${n.name} (${n.group})`])],
      this.selected !== null && this.selected < NET_COUNT ? `${this.selected}` : '',
      (v) => v && this.pick(Number(v)),
    );
    card.append(el('div', { class: 'row' }, b, nets));
    if (!run) card.append(el('p', { class: 'muted small' }, 'Run a program first.'));
    return card;
  }

  private diagnosisCard(): HTMLElement {
    const card = el('div', { class: 'card' }, el('h2', {}, '3. What could it be?'));
    const toggle = el('input', { type: 'checkbox' });
    toggle.checked = this.showSet;
    toggle.addEventListener('change', () => {
      this.showSet = toggle.checked;
      this.renderSide();
    });
    card.append(el('label', { class: 'small' }, toggle, ' Show the faults still consistent with what you have seen'));
    if (!this.showSet) return card;
    const obs = this.observations();
    if (!obs.length) {
      card.append(el('p', { class: 'muted small' }, `${CATALOG.length} single faults are possible before you look at anything.`));
      return card;
    }
    const programs = uniquePrograms([...this.runs.map((r) => r.program), ...TEST_PROGRAMS]);
    const waiting = programs.filter((p) => !this.sigs.ready(p.bytes));
    const observedWaiting = this.runs.filter((r) => !this.sigs.ready(r.program.bytes));
    if (observedWaiting.length) {
      const p = observedWaiting[0].program;
      card.append(el('p', { class: 'muted small' }, `Simulating every fault on ${p.name}… ${Math.round(this.sigs.progress(p.bytes) * 100)}%`));
      return card;
    }
    const d = this.sigs.diagnoser;
    const alive = d.consistent(obs);
    const runPrograms = uniquePrograms(this.runs.map((r) => r.program)).map((p) => p.bytes);
    const groups = d.groups(alive, runPrograms);
    card.append(
      alive.length === 1
        ? el('p', {}, el('strong', {}, 'One fault'), ` of ${CATALOG.length} fits everything you have observed.`)
        : el('p', {}, el('strong', {}, `${alive.length}`), ` of ${CATALOG.length} faults fit everything you have observed, in `, el('strong', {}, `${groups.length}`), groups.length === 1 ? ' group that no probe of these runs can split.' : ' groups that probing these runs could still tell apart.'),
    );
    const byKind = new Map<FaultKind, number[]>();
    for (const i of alive) {
      const k = CATALOG[i].kind;
      byKind.set(k, [...(byKind.get(k) ?? []), i]);
    }
    for (const [kind, list] of byKind) {
      const details = el('details', {}, el('summary', {}, `${KIND_TITLES[kind]}: ${list.length}`));
      // The panel is rebuilt while signatures load; keep expanded groups open.
      details.open = this.openKinds.has(kind);
      details.addEventListener('toggle', () => (details.open ? this.openKinds.add(kind) : this.openKinds.delete(kind)));
      const ul = el('ul', { class: 'faults' });
      for (const i of list.slice(0, 60)) ul.append(el('li', {}, describeFault(CATALOG[i])));
      if (list.length > 60) ul.append(el('li', { class: 'muted' }, `…and ${list.length - 60} more`));
      details.append(ul);
      card.append(details);
    }
    const hintBtn = button('Suggest a next probe', () => {
      if (waiting.length) {
        this.hint = 'Still simulating the test programs, try again in a moment.';
      } else {
        const s = d.bestProbe(alive, programs.map((p) => p.bytes));
        if (alive.length === 1) this.hint = 'Only one fault fits. Name it.';
        else if (!s) this.hint = 'No probe of these programs can split the remaining faults. Write a test program that exercises them differently, or answer.';
        else {
          const prog = programs[s.program].name;
          this.hint =
            s.signal === FREE_SIGNAL
              ? `Run "${prog}" and watch the display: it splits the ${alive.length} remaining faults into ${s.groups} groups (about ${s.expected.toFixed(1)} left on average).`
              : `Probe ${signalName(s.signal)} while running "${prog}": it splits the ${alive.length} remaining faults into ${s.groups} groups (about ${s.expected.toFixed(1)} left on average).`;
        }
      }
      this.renderSide();
    }, 'small');
    hintBtn.disabled = !!this.finished;
    card.append(el('div', { class: 'row' }, hintBtn));
    if (this.hint) card.append(el('p', { class: 'hint small' }, this.hint));
    return card;
  }

  private answerCard(): HTMLElement {
    const card = el('div', { class: 'card' }, el('h2', {}, '4. Name the fault'));
    if (!this.finished) {
      card.append(this.picker.root, el('div', { class: 'row' }, button('Submit diagnosis', () => this.submit(), 'primary')));
      card.append(el('p', { class: 'muted small' }, 'One answer per challenge. A fault that behaves identically on every signal of every test program also counts.'));
      return card;
    }
    const { verdict, answer } = this.finished;
    const msg: Record<Verdict, string> = {
      exact: 'Correct: that is exactly the injected fault.',
      equivalent: 'Accepted: your fault is indistinguishable from the injected one on every signal of every test program.',
      wrong: 'Not this time.',
    };
    card.append(
      el('p', { class: verdict === 'wrong' ? 'bad' : 'good' }, el('strong', {}, msg[verdict])),
      el('p', {}, 'You said: ', el('span', { class: 'mono' }, describeFault(answer))),
      el('p', {}, 'Injected: ', el('span', { class: 'mono' }, describeFault(this.challenge.fault))),
      el('p', { class: 'muted small' }, `Used ${this.probes.length} of ${this.challenge.budget} probes over ${this.runs.length} runs. The board now shows every signal; the fault is outlined.`),
      button('Next challenge', () => this.onNew(this.challenge.tier), 'primary'),
    );
    return card;
  }
}

export function displayPanel(result: RunResult, healthy: RunResult): HTMLElement {
  const values = (r: RunResult) => (r.outputs.length ? r.outputs.map((o) => `${o.value}`).join(' ') : '(nothing)');
  const status = (r: RunResult) => (r.halted ? `halted after ${r.cycles} cycles` : `did not halt within ${DEFAULT_MAX_CYCLES} cycles`);
  const same = values(result) === values(healthy) && result.halted === healthy.halted && result.cycles === healthy.cycles;
  return el(
    'div',
    { class: `display ${same ? '' : 'wrong'}` },
    el('div', {}, el('span', { class: 'muted small' }, 'Display: '), el('span', { class: 'mono big' }, values(result))),
    el('div', { class: 'small' }, status(result)),
    el('div', { class: 'muted small' }, `A healthy board shows ${values(healthy)} and ${status(healthy)}.`),
  );
}

function uniquePrograms(list: readonly Program[]): Program[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = p.bytes.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
