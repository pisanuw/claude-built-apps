// Dropdowns that build one Fault: used for answers, the sandbox and instructor links.

import { CHIP_IDS, CONTROL_LINES, NETS, PINS, type ChipId } from '../core/netlist';
import { KIND_TITLES, SHORT_PAIRS, type Fault, type FaultKind } from '../core/faults';
import { MNEMONIC_OF, STEPS, USED_OPCODES, romAddress } from '../core/isa';
import { el, rebuild, select } from './dom';

interface PickerState {
  kind: FaultKind | 'none';
  net: number;
  value: 0 | 1;
  pin: number;
  short: number;
  chip: ChipId;
  op: number;
  step: number;
  cf: number;
  zf: number;
  bit: number;
}

export class FaultPicker {
  readonly root = el('div', { class: 'picker' });
  private readonly st: PickerState;

  constructor(
    private readonly onChange: () => void,
    private readonly allowNone = false,
  ) {
    this.st = { kind: allowNone ? 'none' : 'stuck', net: 0, value: 0, pin: 0, short: 0, chip: 'RAM', op: USED_OPCODES[1], step: 2, cf: 0, zf: 0, bit: 0 };
    this.render();
  }

  /** Point the picker at a probed signal so answering is quick. */
  focusSignal(netIndex: number | null, pinIndex: number | null): void {
    if (pinIndex !== null) this.st.pin = pinIndex;
    if (netIndex !== null) this.st.net = netIndex;
    this.render();
  }

  get fault(): Fault | null {
    switch (this.st.kind) {
      case 'none': return null;
      case 'stuck': return { kind: 'stuck', net: this.st.net, value: this.st.value };
      case 'open': return { kind: 'open', pin: this.st.pin };
      case 'short': return { kind: 'short', a: SHORT_PAIRS[this.st.short][0], b: SHORT_PAIRS[this.st.short][1] };
      case 'rom': return { kind: 'rom', addr: romAddress(this.st.cf, this.st.zf, this.st.op, this.st.step), bit: this.st.bit };
      case 'dead': return { kind: 'dead', chip: this.st.chip };
    }
  }

  private set<K extends keyof PickerState>(key: K, v: PickerState[K]) {
    this.st[key] = v;
    this.render();
    this.onChange();
  }

  private render() {
    const parts: HTMLElement[] = [];
    const kinds: [string, string][] = Object.entries(KIND_TITLES);
    if (this.allowNone) kinds.unshift(['none', 'No fault (healthy board)']);
    parts.push(select(kinds, this.st.kind, (v) => this.set('kind', v as FaultKind | 'none')));
    const num = (n: number) => `${n}`;
    switch (this.st.kind) {
      case 'stuck':
        parts.push(
          select(NETS.map((n, i) => [num(i), n.name]), num(this.st.net), (v) => this.set('net', Number(v))),
          select([['0', 'stuck at 0'], ['1', 'stuck at 1']], num(this.st.value), (v) => this.set('value', v === '1' ? 1 : 0)),
        );
        break;
      case 'open':
        parts.push(select(PINS.map((p, i) => [num(i), `${p.id} (${p.dir})`]), num(this.st.pin), (v) => this.set('pin', Number(v))));
        break;
      case 'short':
        parts.push(
          select(SHORT_PAIRS.map(([a, b], i) => [num(i), `${NETS[a].name} + ${NETS[b].name}`]), num(this.st.short), (v) => this.set('short', Number(v))),
        );
        break;
      case 'dead':
        parts.push(select(CHIP_IDS.map((c) => [c, c]), this.st.chip, (v) => this.set('chip', v as ChipId)));
        break;
      case 'rom':
        parts.push(
          select(USED_OPCODES.map((op) => [num(op), MNEMONIC_OF[op]]), num(this.st.op), (v) => this.set('op', Number(v))),
          select(Array.from({ length: STEPS }, (_, s) => [num(s), `T${s}`]), num(this.st.step), (v) => this.set('step', Number(v))),
          select([['0', 'CF=0'], ['1', 'CF=1']], num(this.st.cf), (v) => this.set('cf', Number(v))),
          select([['0', 'ZF=0'], ['1', 'ZF=1']], num(this.st.zf), (v) => this.set('zf', Number(v))),
          select(CONTROL_LINES.map((l, i) => [num(i), `bit ${l}`]), num(this.st.bit), (v) => this.set('bit', Number(v))),
        );
        break;
      case 'none':
        break;
    }
    rebuild(this.root, () => parts);
  }
}
