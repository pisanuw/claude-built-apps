// Sandbox: pick any fault (or none), run any program, see every signal and
// how it differs from a healthy board.

import { FREE_SIGNAL } from '../core/diagnosis';
import { describeFault, faultChip } from '../core/faults';
import { AsmError, TEST_PROGRAMS, assemble, describeWord, disassemble } from '../core/isa';
import { CONTROL_LINES, NET_COUNT, SIGNAL_COUNT, netId, signalName } from '../core/netlist';
import { Z, simulate, type RunResult } from '../core/sim';
import { Analyzer } from './analyzer';
import { Board } from './board';
import { faultSignals, displayPanel } from './challengeView';
import { button, clear, el, rebuild, select } from './dom';
import { FaultPicker } from './faultPicker';

const DEFAULT_ROWS = [...[7, 6, 5, 4, 3, 2, 1, 0].map((i) => `BUS${i}`), 'CO', 'MI', 'RO', 'II', 'CE', 'AI', 'EO', 'OI', 'HLT'].map((n) => netId(n));

export class SandboxView {
  readonly root = el('section', { class: 'view sandbox' });
  private choice = '1';
  private source = TEST_PROGRAMS[1].source;
  private error: string | null = null;
  private faulty: RunResult | null = null;
  private healthy: RunResult | null = null;
  private cursor = 0;
  private rows: number[] = [...DEFAULT_ROWS];
  private selected: number | null = null;
  private readonly picker = new FaultPicker(() => this.run(), true);
  private readonly board = new Board((s) => this.toggle(s));
  private readonly analyzer = new Analyzer((c) => {
    this.cursor = c;
    this.render();
  });
  private readonly side = el('div', { class: 'side' });
  private readonly regs = el('div', { class: 'card' });

  constructor() {
    this.root.append(
      el('div', { class: 'layout' }, el('div', { class: 'card board-card' }, this.board.root), this.side),
      el('div', { class: 'card' }, el('h2', {}, 'Logic analyzer'), el('p', { class: 'muted small' }, 'Click any pin or bus line to add or remove it. Rows in orange differ from a healthy board; the healthy waveform is shown underneath. Click a waveform to move the cursor.'), this.analyzer.root),
    );
    this.run();
  }

  private toggle(signal: number) {
    this.selected = signal;
    this.rows = this.rows.includes(signal) ? this.rows.filter((s) => s !== signal) : [...this.rows, signal];
    this.render();
  }

  private run() {
    let bytes: number[];
    try {
      bytes = this.choice === 'custom' ? assemble(this.source) : [...TEST_PROGRAMS[Number(this.choice)].bytes];
      this.error = null;
    } catch (e) {
      this.error = e instanceof AsmError ? e.message : String(e);
      this.render();
      return;
    }
    this.faulty = simulate(bytes, this.picker.fault, { record: true });
    this.healthy = simulate(bytes, null, { record: true });
    this.cursor = Math.min(this.cursor, this.faulty.cycles - 1);
    this.render();
  }

  render(): void {
    const f = this.faulty!;
    const h = this.healthy!;
    const differs = new Set<number>();
    // Compare cycle by cycle over the cycles both runs have, so a run that just ends early
    // does not mark every signal as different.
    const common = Math.min(f.cycles, h.cycles);
    for (let s = 0; s < SIGNAL_COUNT; s++) {
      for (let c = 0; c < common; c++) {
        if (f.records![c].values[s] !== h.records![c].values[s]) {
          differs.add(s);
          break;
        }
      }
    }
    const rec = f.records?.[this.cursor];
    const fault = this.picker.fault;
    this.board.update({
      value: (s) => rec?.values[s],
      selected: this.selected,
      differs,
      faultSignals: fault ? faultSignals(fault) : undefined,
      faultChip: fault ? faultChip(fault) : null,
    });

    rebuild(this.side, () => {
      const options: [string, string][] = TEST_PROGRAMS.map((p, i) => [`${i}`, p.name]);
      options.push(['custom', 'Write your own…']);
      const prog = el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Program'),
        el('div', { class: 'row' }, select(options, this.choice, (v) => {
          this.choice = v;
          if (v !== 'custom') this.source = TEST_PROGRAMS[Number(v)].source;
          this.run();
        }), button('Run', () => this.run(), 'primary')),
      );
      const ta = el('textarea', { rows: '9', spellcheck: 'false', class: 'mono' });
      ta.value = this.source;
      ta.readOnly = this.choice !== 'custom';
      ta.addEventListener('input', () => (this.source = ta.value));
      prog.append(ta);
      if (this.error) prog.append(el('p', { class: 'bad small' }, this.error));
      const faultCard = el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Inject a fault'),
        this.picker.root,
        el('p', { class: 'small' }, fault ? describeFault(fault) : 'Healthy board.'),
        el('p', { class: 'muted small' }, fault ? `${differs.size} of ${SIGNAL_COUNT} signals differ from a healthy board while both are running this program${f.hashes[FREE_SIGNAL] === h.hashes[FREE_SIGNAL] ? ', but the display looks normal: this fault is invisible to this program' : ''}.` : ''),
      );
      faultCard.append(displayPanel(f, h));
      return [prog, faultCard, this.regs];
    });
    this.renderRegs();

    const traces = this.rows.flatMap((s) => {
      const row = { label: signalName(s), values: f.records!.map((c) => c.values[s]), differs: differs.has(s), onRemove: () => this.toggle(s) };
      if (!differs.has(s)) return [row];
      return [row, { label: '', sub: 'healthy', values: h.records!.map((c) => c.values[s]).slice(0, f.cycles) }];
    });
    const steps = f.records!.map((c) => `T${c.state.step}`);
    this.analyzer.render(traces, f.cycles, this.cursor, steps);
  }

  private renderRegs() {
    clear(this.regs);
    const rec = this.faulty?.records?.[this.cursor];
    if (!rec) return;
    const s = rec.state;
    const hex = (v: number, w = 2) => `0x${v.toString(16).padStart(w, '0')}`;
    const ctl = CONTROL_LINES.reduce((acc, l, i) => acc | ((rec.values[netId(l)] === 1 ? 1 : 0) << i), 0);
    const bus = [0, 1, 2, 3, 4, 5, 6, 7].reduce((acc, i) => acc | ((rec.values[i] === 1 ? 1 : 0) << i), 0);
    const rows: [string, string][] = [
      ['cycle', `${this.cursor} (T${s.step})`],
      ['PC', `${s.pc}`],
      ['MAR', `${s.mar}`],
      ['IR', `${hex(s.ir)} ${disassemble(s.ir)}`],
      ['A', `${s.a} (${hex(s.a)})`],
      ['B', `${s.b} (${hex(s.b)})`],
      ['flags', `CF=${s.cf} ZF=${s.zf}`],
      ['OUT', `${s.out}`],
      ['bus', `${bus} (${hex(bus)})`],
      ['control', describeWord(ctl)],
    ];
    const table = el('table', { class: 'regs' });
    for (const [k, v] of rows) table.append(el('tr', {}, el('th', {}, k), el('td', { class: 'mono' }, v)));
    this.regs.append(el('h2', {}, 'Registers at the cursor'), table);
    if (rec.contention) this.regs.append(el('p', { class: 'bad small' }, 'Bus contention: more than one chip is driving a net this cycle.'));
    const ram = el('div', { class: 'ram mono small' });
    rec.ram.forEach((b, i) => ram.append(el('span', { class: i === s.mar ? 'hl' : '' }, `${i.toString().padStart(2, ' ')}: ${hex(b)} ${disassemble(b)}`)));
    this.regs.append(el('details', {}, el('summary', {}, 'RAM'), ram));
    const floating = rec.values.reduce((n, v, i) => n + (v === Z && i < NET_COUNT ? 1 : 0), 0);
    if (floating) this.regs.append(el('p', { class: 'muted small' }, `${floating} nets are floating (Z) this cycle; TTL inputs on them read high.`));
  }
}
