import {
  ALPHABET,
  DEFAULT_CONFIG,
  Enigma,
  REFLECTOR_NAMES,
  ROTOR_NAMES,
  allRotorOrders,
  chr,
  cycles,
  formatCycles,
  groupFives,
  idx,
  normalizeText,
  rotorPermutation,
  validateConfig,
  type EnigmaConfig,
  type ReflectorName,
  type RotorName,
} from '../core/enigma';
import { buildMenu, cribPlacements, describeLoop, type Menu } from '../core/crib';
import { scramblerTable, scramblersAt, sortStops, traceHypothesis, wireMenu, nodeLabel, type Stop, type BombeOptions } from '../core/bombe';
import { MESSAGES, decodeChallenge, encodeChallenge, generateChallenge, gradeAnswer, randomConfig, stopToConfig, type Challenge } from '../core/challenge';
import { renderWiring } from './wiring';
import { renderMenu, LOOP_COLORS } from './menu';
import type { WorkerRequest, WorkerResponse } from '../worker/bombe.worker';
import BombeWorker from '../worker/bombe.worker?worker';

type Tab = 'machine' | 'attack' | 'challenge';

const EXAMPLE = {
  // Weather report enciphered with II IV I, UKW-B, rings AAA, KQZ, plugs AB CD EF GH IJ KL.
  config: { rotors: ['II', 'IV', 'I'] as [RotorName, RotorName, RotorName], reflector: 'B' as ReflectorName, rings: 'AAA', positions: 'KQZ', plugboard: 'AB CD EF GH IJ KL' },
  plaintext: 'WETTERVORHERSAGEBISKAYAXNORDWESTVIER',
  crib: 'WETTERVORHERSAGE',
};

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function plugsOf(steckers: number[]): string {
  const out: string[] = [];
  for (let x = 0; x < 26; x++) {
    const y = steckers[x];
    if (y < 0) continue;
    if (y === x) out.push(chr(x) + ' unplugged');
    else if (y > x) out.push(chr(x) + '↔' + chr(y));
  }
  return out.join(', ') || 'none';
}

export class App {
  private tab: Tab = 'machine';
  private config: EnigmaConfig = { ...DEFAULT_CONFIG };
  private typed = '';
  private viewIndex = -1;
  private showAllWiring = true;

  private ciphertext = '';
  private crib = '';
  private offset = 0;
  private menu: Menu | null = null;
  private testLetter = -1;
  private bombeReflector: ReflectorName = 'B';
  private rotorSet = new Set<RotorName>(ROTOR_NAMES);
  private worker: Worker | null = null;
  private runStart = 0;
  private stops: Stop[] = [];
  private stopCount = 0;
  private selectedStop: Stop | null = null;
  private tracePositions = 'AAA';
  private traceRotors: [RotorName, RotorName, RotorName] = ['I', 'II', 'III'];
  private traceStecker = 0;
  private traceDiagonal = true;
  private tableCache = new Map<string, Int8Array>();

  private challenge: Challenge | null = null;
  private challengeIsStudent = false;

  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};

  constructor(root: HTMLElement) {
    this.root = root;
    const fromUrl = location.hash.startsWith('#c=') ? decodeChallenge(location.hash.slice(3)) : null;
    if (fromUrl) {
      this.challenge = fromUrl;
      this.challengeIsStudent = true;
      this.tab = 'challenge';
    }
    this.build();
    this.renderAll();
    window.addEventListener('hashchange', () => {
      const c = location.hash.startsWith('#c=') ? decodeChallenge(location.hash.slice(3)) : null;
      if (!c || c === this.challenge) return;
      this.challenge = c;
      this.challengeIsStudent = true;
      this.renderChallenge();
      this.setTab('challenge');
    });
  }

  private build(): void {
    this.root.replaceChildren(
      h(`<header class="top">
        <div class="title-row"><h1>Bombe Bench</h1><hw-theme-toggle></hw-theme-toggle></div>
        <span class="tagline">An Enigma you can open up, and the Bombe that broke it.</span>
        <nav class="tabs" role="tablist">
          <button data-tab="machine" role="tab">Machine</button>
          <button data-tab="attack" role="tab">Attack</button>
          <button data-tab="challenge" role="tab">Challenge</button>
        </nav>
      </header>`),
      h(`<main>
        <section id="tab-machine" class="tab"></section>
        <section id="tab-attack" class="tab"></section>
        <section id="tab-challenge" class="tab"></section>
      </main>`),
      h(`<footer class="about">
        <details>
          <summary>How this works, and what it leaves out</summary>
          <p><strong>The machine.</strong> This is the Wehrmacht Enigma I: rotors I to V (any three, in any order), reflectors A, B and C, ring settings, a plugboard with up to thirteen leads, and the stepping mechanism including the double step of the middle rotor. Pressing a key moves the rotors first, then sends current through the plugboard, the three rotors right to left, the reflector, the rotors left to right, and the plugboard again. Because the reflector pairs letters up, the whole machine is an involution at every position: the key that enciphers A to K also enciphers K to A, and no letter ever enciphers to itself. That second fact is the crack the attack starts from.</p>
          <p><strong>The attack.</strong> A crib is a guess at a stretch of plaintext (weather reports began with WETTERVORHERSAGE often enough). Slide it along the ciphertext and every position where a letter would have to encipher to itself is impossible. At a surviving position, each crib letter and the ciphertext letter above it make one edge of the <em>menu</em>, labelled by its position in the crib. Loops in the menu are what the Bombe needs: follow a loop's scramblers around and you must get back to the plugboard partner you started from, which holds for the true settings and fails for almost every other. The Bombe tries the 26 possibilities for one letter's plug partner at every rotor order and position; Welchman's diagonal board adds the observation that if A is plugged to B, then B is plugged to A, so the implications spread through the whole menu. A position where every hypothesis contradicts itself is rejected; the rest are stops, which the checking machine (here: a consistency check on the implied plugs plus the other menu components) then thins out.</p>
          <p><strong>Left out.</strong> The Bombe assumes the middle rotor does not move during the crib, and reports rotor positions with the ring settings at A, which is what the historical machine did too. A challenge with random ring settings therefore decrypts correctly through the crib and then drifts after the first turnover; finding the ring setting that fixes it is the student's last step. There is no Enigma M4, no Uhr, and no simulation of the Bombe's actual drums and relays; the search is the logic, not the hardware. Everything runs in your browser, with no server and no AI calls.</p>
        </details>
        <p class="credits">Built from an idea on the <a href="https://pisanuw.github.io/daily-project-ideas/">daily project ideas</a> page. Source: <a href="https://github.com/pisanuw/Claude-capstone/tree/main/bombe-bench">pisanuw/Claude-capstone</a>.</p>
      </footer>`),
    );
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs button')) {
      b.addEventListener('click', () => this.setTab(b.dataset.tab as Tab));
    }
    this.buildMachine();
    this.buildAttack();
    this.buildChallenge();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs button')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const s of this.root.querySelectorAll<HTMLElement>('.tab')) s.classList.toggle('active', s.id === 'tab-' + tab);
  }

  private renderAll(): void {
    this.setTab(this.tab);
    this.renderMachine();
    this.renderAttack();
    this.renderChallenge();
  }

  // ---------------------------------------------------------------- Machine

  private buildMachine(): void {
    const sec = this.root.querySelector('#tab-machine')!;
    const rotorSel = (name: string) => `<select data-rotor="${name}" aria-label="Rotor ${name}">${ROTOR_NAMES.map((r) => `<option>${r}</option>`).join('')}</select>`;
    sec.replaceChildren(
      h(`<div class="panel settings">
        <div class="row">
          <label>Rotors (left to right) ${rotorSel('0')} ${rotorSel('1')} ${rotorSel('2')}</label>
          <label>Reflector <select id="m-reflector">${REFLECTOR_NAMES.map((r) => `<option>${r}</option>`).join('')}</select></label>
          <label>Ring settings <input id="m-rings" maxlength="3" size="4" class="mono" spellcheck="false" /></label>
          <label>Positions <input id="m-positions" maxlength="3" size="4" class="mono" spellcheck="false" /></label>
          <label class="grow">Plugboard <input id="m-plugboard" class="mono grow" placeholder="e.g. AM FI NV PS TU WZ" spellcheck="false" /></label>
        </div>
        <div class="row">
          <button id="m-random" class="small">Random settings</button>
          <button id="m-example" class="small">Example (weather report)</button>
          <button id="m-clear" class="small">Clear text</button>
          <label class="check"><input type="checkbox" id="m-allwires" checked /> Show all wiring</label>
          <span id="m-error" class="error"></span>
        </div>
      </div>`),
      h(`<div class="panel typing">
        <label class="block">Type a message (letters only; the machine starts from the positions above and steps once per letter)
          <input id="m-input" class="mono wide" spellcheck="false" autocomplete="off" placeholder="Type here…" /></label>
        <div class="tape">
          <div><span class="muted">In </span><code id="m-tape-in"></code></div>
          <div><span class="muted">Out</span><code id="m-tape-out"></code></div>
        </div>
        <div class="lamps" id="m-lamps"></div>
        <div class="row">
          <label class="grow">Step through <input type="range" id="m-step" min="0" max="0" value="0" /></label>
          <span id="m-stepinfo" class="muted"></span>
        </div>
      </div>`),
      h(`<div class="panel"><div id="m-wiring" class="wiring-wrap" tabindex="0" role="region" aria-label="Wiring diagram"></div>
        <p class="legend"><span class="sw fwd"></span> outbound <span class="sw bwd"></span> return <span class="muted">· contacts are labelled in the fixed frame of the machine; a rotor's window letter shifts its wiring against them.</span></p>
      </div>`),
      h(`<div class="panel"><h2>Permutations and cycles</h2><div id="m-cycles" class="cycles"></div></div>`),
    );
    const q = <T extends HTMLElement>(id: string) => sec.querySelector<T>('#' + id)!;
    this.els.mError = q('m-error');
    this.els.mInput = q('m-input');
    this.els.mTapeIn = q('m-tape-in');
    this.els.mTapeOut = q('m-tape-out');
    this.els.mLamps = q('m-lamps');
    this.els.mStep = q('m-step');
    this.els.mStepInfo = q('m-stepinfo');
    this.els.mWiring = q('m-wiring');
    this.els.mCycles = q('m-cycles');
    this.els.mRings = q('m-rings');
    this.els.mPositions = q('m-positions');
    this.els.mPlugboard = q('m-plugboard');
    this.els.mReflector = q('m-reflector');

    const readSettings = () => {
      const rotors = [...sec.querySelectorAll<HTMLSelectElement>('select[data-rotor]')].map((s) => s.value as RotorName) as [RotorName, RotorName, RotorName];
      const rings = normalizeText((this.els.mRings as HTMLInputElement).value).padEnd(3, 'A').slice(0, 3);
      const positions = normalizeText((this.els.mPositions as HTMLInputElement).value).padEnd(3, 'A').slice(0, 3);
      const next: EnigmaConfig = { rotors, reflector: (this.els.mReflector as HTMLSelectElement).value as ReflectorName, rings, positions, plugboard: (this.els.mPlugboard as HTMLInputElement).value };
      const problems = validateConfig(next);
      this.els.mError.textContent = problems.join(' ');
      if (!problems.length) {
        this.config = next;
        this.renderMachine();
      }
    };
    for (const s of sec.querySelectorAll('select')) s.addEventListener('change', readSettings);
    for (const id of ['m-rings', 'm-positions', 'm-plugboard']) q<HTMLInputElement>(id).addEventListener('input', readSettings);
    q('m-random').addEventListener('click', () => {
      this.config = randomConfig(Math.random);
      this.renderMachine();
    });
    q('m-example').addEventListener('click', () => {
      this.config = { ...EXAMPLE.config };
      this.typed = EXAMPLE.plaintext;
      this.viewIndex = -1;
      this.renderMachine();
    });
    q('m-clear').addEventListener('click', () => {
      this.typed = '';
      this.viewIndex = -1;
      this.renderMachine();
    });
    q<HTMLInputElement>('m-allwires').addEventListener('change', (e) => {
      this.showAllWiring = (e.target as HTMLInputElement).checked;
      this.renderMachine();
    });
    (this.els.mInput as HTMLInputElement).addEventListener('input', (e) => {
      this.typed = normalizeText((e.target as HTMLInputElement).value);
      this.viewIndex = -1;
      this.renderMachine();
    });
    (this.els.mStep as HTMLInputElement).addEventListener('input', (e) => {
      this.viewIndex = Number((e.target as HTMLInputElement).value) - 1;
      this.renderMachine();
    });
  }

  private renderMachine(): void {
    const sec = this.root.querySelector('#tab-machine')!;
    const c = this.config;
    sec.querySelectorAll<HTMLSelectElement>('select[data-rotor]').forEach((s, i) => (s.value = c.rotors[i]));
    (this.els.mReflector as HTMLSelectElement).value = c.reflector;
    const setIf = (el: HTMLElement, v: string) => {
      const input = el as HTMLInputElement;
      if (document.activeElement !== input) input.value = v;
    };
    setIf(this.els.mRings, c.rings);
    setIf(this.els.mPositions, c.positions);
    setIf(this.els.mPlugboard, c.plugboard);
    setIf(this.els.mInput, this.typed);

    const machine = new Enigma(c);
    const { text, traces } = machine.encipher(this.typed);
    const n = traces.length;
    const step = this.els.mStep as HTMLInputElement;
    step.max = String(n);
    const view = this.viewIndex < 0 || this.viewIndex >= n ? n - 1 : this.viewIndex;
    step.value = String(view + 1);
    step.disabled = n === 0;
    const trace = view >= 0 ? traces[view] : null;

    this.els.mTapeIn.textContent = groupFives(this.typed);
    this.els.mTapeOut.textContent = groupFives(text);
    this.els.mTapeIn.innerHTML = tapeHtml(this.typed, view);
    this.els.mTapeOut.innerHTML = tapeHtml(text, view);

    const lamps = this.els.mLamps;
    lamps.replaceChildren(...[...ALPHABET].map((L, i) => h(`<span class="lamp${trace && trace.output === i ? ' lit' : ''}">${L}</span>`)));

    // Machine state as it was for the viewed keypress.
    const shown = new Enigma(c);
    for (let i = 0; i <= view; i++) shown.press(this.typed[i]);
    renderWiring(this.els.mWiring, shown, trace, { showAllWiring: this.showAllWiring });

    if (trace) {
      const moved = ['left', 'middle', 'right'].filter((_, i) => trace.stepped[i]);
      const dbl = trace.stepped[0] ? ' (the middle rotor was at its notch, so it carried the left rotor and moved again itself: the double step)' : '';
      this.els.mStepInfo.textContent = `Key ${view + 1} of ${n}: ${this.typed[view]} → ${text[view]} at window ${trace.positions}; ${moved.join(' + ')} rotor${moved.length > 1 ? 's' : ''} stepped${dbl}.`;
    } else {
      this.els.mStepInfo.textContent = `Window ${c.positions}. Type to see the signal path.`;
    }

    // Cycle structure.
    const rows: string[] = [];
    const states = [
      ['Left', shown.left],
      ['Middle', shown.middle],
      ['Right', shown.right],
    ] as const;
    for (const [label, r] of states) {
      const perm = rotorPermutation(r.spec.name, r.pos, r.ring);
      const cs = cycles(perm);
      rows.push(`<div><b>${label} rotor ${r.spec.name}</b> at window ${chr(r.pos)}, ring ${chr(r.ring)}: <code>${formatCycles(cs)}</code> <span class="muted">(${cs.length} cycle${cs.length === 1 ? '' : 's'}, lengths ${cs.map((x) => x.length).join(' ')})</span></div>`);
    }
    const scr = cycles(shown.scrambler());
    rows.push(`<div><b>Whole rotor stack + reflector</b> at window ${shown.positions}: <code>${formatCycles(scr)}</code> <span class="muted">(13 transpositions: an involution with no fixed points, so no letter can encipher to itself)</span></div>`);
    rows.push(`<p class="muted">A rotor's own wiring is a fixed permutation; turning it conjugates that permutation by a shift, which keeps the cycle lengths and changes the letters. The cycle lengths of the plugboard-free stack at a given position were exactly what Rejewski used to recover the rotor wirings in 1932.</p>`);
    this.els.mCycles.innerHTML = rows.join('');
  }

  // ----------------------------------------------------------------- Attack

  private buildAttack(): void {
    const sec = this.root.querySelector('#tab-attack')!;
    sec.replaceChildren(
      h(`<div class="panel">
        <div class="row">
          <label class="grow block">Ciphertext <textarea id="a-ct" class="mono" rows="3" spellcheck="false" placeholder="Paste the intercepted message"></textarea></label>
        </div>
        <div class="row">
          <label class="grow">Crib (guessed plaintext) <input id="a-crib" class="mono grow" spellcheck="false" placeholder="e.g. WETTERVORHERSAGE" /></label>
          <button id="a-example" class="small">Load example</button>
          <button id="a-from-machine" class="small">Use the Machine tab's output</button>
        </div>
      </div>`),
      h(`<div class="panel"><h2>1. Slide the crib</h2>
        <p class="muted">Enigma never enciphers a letter to itself, so any position where the crib and the ciphertext share a letter in the same column is impossible.</p>
        <div id="a-strip" class="strip" tabindex="0" role="region" aria-label="The crib under the ciphertext"></div>
        <div class="row"><label class="grow">Offset <input type="range" id="a-offset" min="0" max="0" value="0" /></label><span id="a-offset-info"></span></div>
        <div id="a-valid" class="chips"></div>
      </div>`),
      h(`<div class="panel"><h2>2. The menu</h2>
        <div class="split">
          <div id="a-menu" class="menu-wrap"></div>
          <div id="a-menu-info" class="menu-info"></div>
        </div>
      </div>`),
      h(`<div class="panel"><h2>3. Run the Bombe</h2>
        <div class="row">
          <label>Reflector <select id="a-reflector">${REFLECTOR_NAMES.map((r) => `<option${r === 'B' ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
          <span>Rotors in play ${ROTOR_NAMES.map((r) => `<label class="check"><input type="checkbox" data-rotor-set="${r}" checked /> ${r}</label>`).join(' ')}</span>
          <label>Test register <select id="a-test"></select></label>
          <button id="a-run" class="primary">Run Bombe</button>
          <button id="a-cancel" class="small" disabled>Cancel</button>
        </div>
        <div class="progress"><div id="a-bar" class="bar"></div></div>
        <div id="a-progress" class="muted"></div>
        <div id="a-stops"></div>
        <div id="a-stop-detail"></div>
      </div>`),
      h(`<div class="panel"><h2>4. Trace one hypothesis</h2>
        <p class="muted">Pick a rotor order and position (a stop, the true settings from the Machine tab, or anything) and follow the implications of "the test letter is plugged to X". With the true settings one hypothesis survives; with wrong ones the current spreads until the test register is lit twice, which is the contradiction.</p>
        <div class="row">
          <label>Rotors <input id="t-rotors" class="mono" size="10" placeholder="II IV I" /></label>
          <label>Position at crib start <input id="t-pos" class="mono" maxlength="3" size="4" /></label>
          <label>Hypothesis: test letter ↔ <select id="t-stecker">${[...ALPHABET].map((L) => `<option>${L}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="t-diag" checked /> Diagonal board</label>
          <button id="t-run" class="small">Trace</button>
          <button id="t-all" class="small">Try all 26</button>
          <button id="t-random" class="small">Random wrong position</button>
        </div>
        <div id="t-out" class="trace-out"></div>
      </div>`),
    );
    const q = <T extends HTMLElement>(id: string) => sec.querySelector<T>('#' + id)!;
    this.els.aCt = q('a-ct');
    this.els.aCrib = q('a-crib');
    this.els.aStrip = q('a-strip');
    this.els.aOffset = q('a-offset');
    this.els.aOffsetInfo = q('a-offset-info');
    this.els.aValid = q('a-valid');
    this.els.aMenu = q('a-menu');
    this.els.aMenuInfo = q('a-menu-info');
    this.els.aTest = q('a-test');
    this.els.aRun = q('a-run');
    this.els.aCancel = q('a-cancel');
    this.els.aBar = q('a-bar');
    this.els.aProgress = q('a-progress');
    this.els.aStops = q('a-stops');
    this.els.aStopDetail = q('a-stop-detail');
    this.els.tRotors = q('t-rotors');
    this.els.tPos = q('t-pos');
    this.els.tStecker = q('t-stecker');
    this.els.tOut = q('t-out');

    q<HTMLTextAreaElement>('a-ct').addEventListener('input', (e) => {
      this.ciphertext = normalizeText((e.target as HTMLTextAreaElement).value);
      this.resetAttack();
    });
    q<HTMLInputElement>('a-crib').addEventListener('input', (e) => {
      this.crib = normalizeText((e.target as HTMLInputElement).value);
      this.resetAttack();
    });
    q('a-example').addEventListener('click', () => {
      this.ciphertext = new Enigma(EXAMPLE.config).encipher(EXAMPLE.plaintext).text;
      this.crib = EXAMPLE.crib;
      this.config = { ...EXAMPLE.config };
      this.typed = EXAMPLE.plaintext;
      this.resetAttack();
      this.renderMachine();
    });
    q('a-from-machine').addEventListener('click', () => {
      const out = new Enigma(this.config).encipher(this.typed).text;
      this.ciphertext = out;
      if (!this.crib) this.crib = this.typed.slice(0, Math.min(16, this.typed.length));
      this.resetAttack();
    });
    q<HTMLInputElement>('a-offset').addEventListener('input', (e) => {
      this.offset = Number((e.target as HTMLInputElement).value);
      this.testLetter = -1;
      this.renderAttack();
    });
    q<HTMLSelectElement>('a-reflector').addEventListener('change', (e) => {
      this.bombeReflector = (e.target as HTMLSelectElement).value as ReflectorName;
    });
    for (const cb of sec.querySelectorAll<HTMLInputElement>('input[data-rotor-set]')) {
      cb.addEventListener('change', () => {
        const r = cb.dataset.rotorSet as RotorName;
        if (cb.checked) this.rotorSet.add(r);
        else this.rotorSet.delete(r);
        this.renderAttack();
      });
    }
    q<HTMLSelectElement>('a-test').addEventListener('change', (e) => {
      this.testLetter = idx((e.target as HTMLSelectElement).value);
      this.renderAttack();
    });
    q('a-run').addEventListener('click', () => this.runBombe());
    q('a-cancel').addEventListener('click', () => this.cancelBombe());
    q('t-run').addEventListener('click', () => this.runTrace(false));
    q('t-all').addEventListener('click', () => this.runTrace(true));
    q('t-random').addEventListener('click', () => {
      const orders = allRotorOrders();
      this.traceRotors = orders[Math.floor(Math.random() * orders.length)];
      this.tracePositions = chr(Math.floor(Math.random() * 26)) + chr(Math.floor(Math.random() * 26)) + chr(Math.floor(Math.random() * 26));
      (this.els.tRotors as HTMLInputElement).value = this.traceRotors.join(' ');
      (this.els.tPos as HTMLInputElement).value = this.tracePositions;
      this.runTrace(true);
    });
    q<HTMLSelectElement>('t-stecker').addEventListener('change', (e) => {
      this.traceStecker = idx((e.target as HTMLSelectElement).value);
    });
    q<HTMLInputElement>('t-diag').addEventListener('change', (e) => {
      this.traceDiagonal = (e.target as HTMLInputElement).checked;
    });
  }

  private resetAttack(): void {
    this.cancelBombe();
    this.stops = [];
    this.stopCount = 0;
    this.selectedStop = null;
    this.testLetter = -1;
    const placements = cribPlacements(this.ciphertext, this.crib);
    const firstValid = placements.find((p) => p.valid);
    this.offset = firstValid ? firstValid.offset : 0;
    this.els.aProgress.textContent = '';
    (this.els.aBar as HTMLElement).style.width = '0%';
    this.renderAttack();
  }

  private renderAttack(): void {
    const ct = this.els.aCt as HTMLTextAreaElement;
    if (document.activeElement !== ct) ct.value = groupFives(this.ciphertext);
    const cribIn = this.els.aCrib as HTMLInputElement;
    if (document.activeElement !== cribIn) cribIn.value = this.crib;

    const placements = cribPlacements(this.ciphertext, this.crib);
    const maxOffset = Math.max(0, this.ciphertext.length - this.crib.length);
    const range = this.els.aOffset as HTMLInputElement;
    range.max = String(maxOffset);
    range.disabled = placements.length === 0;
    if (this.offset > maxOffset) this.offset = maxOffset;
    range.value = String(this.offset);

    // The strip.
    const strip = this.els.aStrip;
    if (!this.ciphertext || !this.crib) {
      strip.innerHTML = '<span class="muted">Ciphertext and crib go here.</span>';
    } else if (this.crib.length > this.ciphertext.length) {
      strip.innerHTML = '<span class="error">The crib is longer than the ciphertext.</span>';
    } else {
      const placement = placements[this.offset];
      const clash = new Set(placement.clashes.map((i) => i + this.offset));
      const top = [...this.ciphertext].map((ch, i) => `<span class="cell${i >= this.offset && i < this.offset + this.crib.length ? ' under' : ''}${clash.has(i) ? ' clash' : ''}">${ch}</span>`).join('');
      const bottom = [...this.ciphertext].map((_, i) => {
        const k = i - this.offset;
        const ch = k >= 0 && k < this.crib.length ? this.crib[k] : '';
        return `<span class="cell${ch ? ' crib' : ''}${clash.has(i) ? ' clash' : ''}">${ch || '&nbsp;'}</span>`;
      }).join('');
      const nums = [...this.ciphertext].map((_, i) => `<span class="cell idx">${(i + 1) % 5 === 0 ? i + 1 : '&nbsp;'}</span>`).join('');
      strip.innerHTML = `<div class="strip-row">${nums}</div><div class="strip-row ct">${top}</div><div class="strip-row">${bottom}</div>`;
    }
    const valid = placements.filter((p) => p.valid);
    const cur = placements[this.offset];
    this.els.aOffsetInfo.innerHTML = cur
      ? cur.valid
        ? `offset ${this.offset}: <b class="ok">possible</b>`
        : `offset ${this.offset}: <b class="bad">impossible</b>, ${cur.clashes.length} letter${cur.clashes.length === 1 ? '' : 's'} would encipher to ${cur.clashes.length === 1 ? 'itself' : 'themselves'}`
      : '';
    this.els.aValid.replaceChildren(
      ...(placements.length
        ? [h(`<span class="muted">${valid.length} of ${placements.length} positions possible:</span>`), ...valid.map((p) => {
            const b = h(`<button class="chip${p.offset === this.offset ? ' on' : ''}">${p.offset}</button>`);
            b.addEventListener('click', () => {
              this.offset = p.offset;
              this.testLetter = -1;
              this.renderAttack();
            });
            return b;
          })]
        : []),
    );

    // Menu.
    this.menu = cur ? buildMenu(this.ciphertext, this.crib, this.offset) : null;
    const menu = this.menu;
    if (menu && (this.testLetter < 0 || !menu.letters.includes(this.testLetter))) this.testLetter = menu.testLetter;
    const testSel = this.els.aTest as HTMLSelectElement;
    testSel.replaceChildren(...(menu ? menu.letters.map((l) => h(`<option${l === this.testLetter ? ' selected' : ''}>${chr(l)}</option>`)) : []));
    if (menu) {
      renderMenu(this.els.aMenu, menu, {
        testLetter: this.testLetter,
        highlightLoops: true,
        onPickLetter: (l) => {
          this.testLetter = l;
          this.renderAttack();
        },
      });
      const loops = menu.loops.map((_, i) => `<li><span class="sw" style="background:${LOOP_COLORS[i % LOOP_COLORS.length]}"></span> ${describeLoop(menu.loopLetters[i])} <span class="muted">(positions ${menu.loops[i].map((e) => e.i + 1).join(', ')})</span></li>`);
      const comps = menu.components.map((c) => c.map(chr).join('')).join(', ');
      this.els.aMenuInfo.innerHTML = `
        <div><b>${menu.letters.length}</b> letters, <b>${menu.edges.length}</b> edges, <b>${menu.loopCount}</b> independent loop${menu.loopCount === 1 ? '' : 's'}, ${menu.components.length} component${menu.components.length === 1 ? '' : 's'} (${comps}).</div>
        <div>Test register: <b>${chr(this.testLetter)}</b> (${menu.degree[this.testLetter]} connections). Click a letter to change it.</div>
        ${loops.length ? `<ul class="loops">${loops.join('')}</ul>` : '<p class="muted">No loops: only the diagonal board can produce contradictions here, and the Bombe will stop far more often. A longer crib, or one with repeated letters, helps.</p>'}
        <p class="muted">Each edge says: at that crib position, the scrambler maps the plug partner of one letter to the plug partner of the other. Around a loop the plug partners cancel out, so the composed scramblers must send the starting letter's partner back to itself; that is a test with no unknowns in it, and it fails for about 24 of every 26 wrong positions. ${!cur?.valid ? '<b class="bad">This offset is impossible; the Bombe will run but cannot find the truth here.</b>' : ''}</p>`;
    } else {
      this.els.aMenu.replaceChildren();
      this.els.aMenuInfo.innerHTML = '';
    }
    const orders = allRotorOrders([...this.rotorSet]);
    (this.els.aRun as HTMLButtonElement).disabled = !menu || orders.length === 0 || this.worker !== null;
    this.els.aRun.textContent = `Run Bombe (${orders.length} rotor order${orders.length === 1 ? '' : 's'} × 17,576 positions)`;
    this.renderStops();
  }

  private runBombe(): void {
    if (!this.menu || this.worker) return;
    const orders = allRotorOrders([...this.rotorSet]);
    const options: BombeOptions = { menu: this.menu, reflector: this.bombeReflector, rotorOrders: orders, testLetter: this.testLetter, maxStops: 400 };
    this.stops = [];
    this.stopCount = 0;
    this.selectedStop = null;
    this.runStart = performance.now();
    this.worker = new BombeWorker();
    (this.els.aCancel as HTMLButtonElement).disabled = false;
    (this.els.aRun as HTMLButtonElement).disabled = true;
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') {
        const pct = (100 * m.configsDone) / m.total;
        (this.els.aBar as HTMLElement).style.width = pct.toFixed(1) + '%';
        this.els.aProgress.innerHTML = `Rotor order ${m.ordersDone + 1} of ${m.orders} (${m.currentOrder}) · ${m.configsDone.toLocaleString()} of ${m.total.toLocaleString()} positions tested · <b>${(m.configsDone - m.stopCount).toLocaleString()}</b> rejected · <b>${m.stopCount}</b> stop${m.stopCount === 1 ? '' : 's'} · ${((performance.now() - this.runStart) / 1000).toFixed(1)} s`;
      } else if (m.type === 'done') {
        this.stops = sortStops(m.stops);
        this.stopCount = m.stopCount;
        (this.els.aBar as HTMLElement).style.width = '100%';
        const checked = this.stops.filter((s) => s.checked).length;
        this.els.aProgress.innerHTML = `Done in ${(m.ms / 1000).toFixed(1)} s: ${m.configsDone.toLocaleString()} positions tested, <b>${(m.configsDone - m.stopCount).toLocaleString()}</b> rejected, <b>${m.stopCount}</b> stop${m.stopCount === 1 ? '' : 's'}, <b>${checked}</b> passed the checking machine.${m.stopCount > m.stops.length ? ` Showing the first ${m.stops.length}.` : ''}`;
        this.selectedStop = this.stops[0] ?? null;
        this.finishBombe();
      } else {
        this.els.aProgress.textContent = 'Error: ' + m.message;
        this.finishBombe();
      }
    };
    this.worker.postMessage({ type: 'run', options } satisfies WorkerRequest);
    this.renderStops();
  }

  private cancelBombe(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.finishBombe();
    this.els.aProgress.textContent = 'Cancelled.';
  }

  private finishBombe(): void {
    this.worker?.terminate();
    this.worker = null;
    (this.els.aCancel as HTMLButtonElement).disabled = true;
    (this.els.aRun as HTMLButtonElement).disabled = !this.menu;
    this.renderStops();
  }

  private renderStops(): void {
    const box = this.els.aStops;
    if (!this.stops.length) {
      box.innerHTML = this.stopCount ? '' : '';
      this.els.aStopDetail.innerHTML = '';
      return;
    }
    const rows = this.stops.slice(0, 60).map((s, i) => {
      const hyp = s.hypotheses[0];
      return `<tr class="${s === this.selectedStop ? 'sel' : ''}${s.checked ? ' checked' : ''}" data-i="${i}">
        <td>${s.rotors.join(' ')}</td><td class="mono">${s.positions}</td>
        <td>${chr(s.testLetter)}↔${s.hypotheses.map((x) => chr(x.stecker)).join('/')}</td>
        <td>${hyp.cribMatches}/${this.menu?.crib.length ?? 0}</td>
        <td>${s.checked ? '<span class="ok">✓ consistent</span>' : hyp.contradictions.length ? `<span class="bad">✗ ${hyp.contradictions.map(chr).join('')} plugged twice</span>` : `<span class="bad">✗ ${s.otherComponents - s.otherComponentsOk} component${s.otherComponents - s.otherComponentsOk === 1 ? '' : 's'} dead</span>`}</td>
      </tr>`;
    });
    // A named region in the tab order: on a phone the table scrolls sideways inside it, not the page.
    box.innerHTML = `<div class="table-scroll" tabindex="0" role="region" aria-label="Bombe stops"><table class="stops"><thead><tr><th>Rotors</th><th>Window at crib start</th><th>Test plug</th><th>Crib reproduced</th><th>Checking machine</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    for (const tr of box.querySelectorAll<HTMLTableRowElement>('tr[data-i]')) {
      tr.addEventListener('click', () => {
        this.selectedStop = this.stops[Number(tr.dataset.i)];
        this.renderStops();
      });
    }
    this.renderStopDetail();
  }

  private renderStopDetail(): void {
    const s = this.selectedStop;
    const box = this.els.aStopDetail;
    if (!s || !this.menu) {
      box.innerHTML = '';
      return;
    }
    const hyp = s.hypotheses[0];
    const cfg = stopToConfig(s.rotors, this.bombeReflector, s.positions, this.offset, hyp.steckers);
    const plain = new Enigma(cfg).encipher(this.ciphertext).text;
    const marked = [...plain].map((ch, i) => (i >= this.offset && i < this.offset + this.crib.length ? `<span class="under">${ch}</span>` : ch)).join('');
    const known = hyp.steckers.filter((x) => x >= 0).length;
    box.innerHTML = `<div class="stop-detail">
      <h3>Stop: rotors ${s.rotors.join(' ')}, window ${s.positions} at the first crib letter (ring settings A)</h3>
      <div>Implied plugs for ${known} letter${known === 1 ? '' : 's'}: <code>${plugsOf(hyp.steckers)}</code></div>
      ${hyp.contradictions.length ? `<div class="bad">Contradiction: ${hyp.contradictions.map(chr).join(', ')} would need two different plug partners.</div>` : ''}
      ${s.otherComponents ? `<div>Other menu components: ${s.otherComponentsOk} of ${s.otherComponents} keep a consistent hypothesis.</div>` : ''}
      <div>Wound back ${this.offset + 1} step${this.offset === 0 ? '' : 's'} to the message start: <code>${cfg.positions}</code>. Decrypt with these settings (unknown plugs left straight, crib span underlined):</div>
      <pre class="plain">${marked}</pre>
      <div class="row"><button id="s-load" class="small">Load into the Machine tab</button> <button id="s-trace" class="small">Trace this stop's hypotheses</button></div>
    </div>`;
    box.querySelector('#s-load')!.addEventListener('click', () => {
      this.config = cfg;
      this.typed = this.ciphertext;
      this.viewIndex = -1;
      this.renderMachine();
      this.setTab('machine');
    });
    box.querySelector('#s-trace')!.addEventListener('click', () => {
      this.traceRotors = s.rotors;
      this.tracePositions = s.positions;
      this.traceStecker = hyp.stecker;
      (this.els.tRotors as HTMLInputElement).value = s.rotors.join(' ');
      (this.els.tPos as HTMLInputElement).value = s.positions;
      (this.els.tStecker as HTMLSelectElement).value = chr(hyp.stecker);
      this.runTrace(true);
      this.els.tOut.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  private tableFor(rotors: [RotorName, RotorName, RotorName], reflector: ReflectorName): Int8Array {
    const key = rotors.join(',') + reflector;
    let t = this.tableCache.get(key);
    if (!t) {
      t = scramblerTable(rotors, reflector);
      this.tableCache.set(key, t);
      if (this.tableCache.size > 8) this.tableCache.delete(this.tableCache.keys().next().value!);
    }
    return t;
  }

  private runTrace(all: boolean): void {
    const out = this.els.tOut;
    if (!this.menu) {
      out.innerHTML = '<span class="muted">Build a menu first.</span>';
      return;
    }
    const rotorsText = normalizeText((this.els.tRotors as HTMLInputElement).value.replace(/[^IV\s]/gi, ' ')).length
      ? (this.els.tRotors as HTMLInputElement).value.toUpperCase().split(/[\s,]+/).filter(Boolean)
      : [];
    const rotors = rotorsText.length === 3 && rotorsText.every((r) => ROTOR_NAMES.includes(r as RotorName)) && new Set(rotorsText).size === 3 ? (rotorsText as [RotorName, RotorName, RotorName]) : this.traceRotors;
    this.traceRotors = rotors;
    const pos = normalizeText((this.els.tPos as HTMLInputElement).value);
    this.tracePositions = /^[A-Z]{3}$/.test(pos) ? pos : this.tracePositions;
    (this.els.tRotors as HTMLInputElement).value = rotors.join(' ');
    (this.els.tPos as HTMLInputElement).value = this.tracePositions;
    const table = this.tableFor(rotors, this.bombeReflector);
    const scr = scramblersAt(table, this.tracePositions, this.menu.crib.length);
    const wiring = wireMenu(this.menu, this.testLetter);
    const T = this.testLetter;
    const letters = all ? [...Array(26).keys()] : [this.traceStecker];
    const parts: string[] = [];
    let survivors = 0;
    for (const a of letters) {
      const tr = traceHypothesis(scr, wiring, T, a, this.traceDiagonal);
      if (!tr.refuted) survivors++;
      const steps = tr.steps.map((st) => {
        const via = st.via === 'diagonal' ? 'diagonal board' : `position ${st.edge!.i + 1} (${chr(st.edge!.a)}/${chr(st.edge!.b)})`;
        return `<li class="${st.contradiction ? 'bad' : ''}">${nodeLabel(st.from)} ⟹ <span class="muted">${via}</span> ⟹ <b>${nodeLabel(st.to)}</b>${st.contradiction ? ' ✗ contradiction: ' + chr(T) + ' is already ' + chr(T) + '→' + chr(a) : ''}</li>`;
      });
      const summary = tr.refuted
        ? `<b class="bad">Refuted</b> after ${tr.steps.length} implication${tr.steps.length === 1 ? '' : 's'}; ${tr.lit.length} of 26 test-register lamps lit.`
        : `<b class="ok">Survives</b>: ${tr.steps.length} implications, only lamp ${chr(a)} lit on the test register.`;
      parts.push(`<details${!all || !tr.refuted ? ' open' : ''}><summary>${chr(T)}→${chr(a)}: ${summary}</summary><ol class="steps">${steps.join('')}</ol></details>`);
    }
    out.innerHTML = `<div class="trace-summary">Rotors ${rotors.join(' ')}, window ${this.tracePositions}, test register ${chr(T)}${this.traceDiagonal ? '' : ', diagonal board off'}: <b>${survivors}</b> of ${letters.length} hypothes${letters.length === 1 ? 'is' : 'es'} survive${survivors === 1 ? 's' : ''}${all ? (survivors ? ' → the Bombe stops here.' : ' → the Bombe moves on.') : ''}</div>${parts.join('')}`;
  }

  // -------------------------------------------------------------- Challenge

  private buildChallenge(): void {
    const sec = this.root.querySelector('#tab-challenge')!;
    sec.replaceChildren(h(`<div id="c-student"></div>`), h(`<div class="panel" id="c-gen">
      <h2>Make a challenge</h2>
      <div class="row">
        <label>Message <select id="c-msg"><option value="-1">random</option>${MESSAGES.map((m, i) => `<option value="${i}">${m.title}</option>`).join('')}</select></label>
        <label>Plug pairs <input type="number" id="c-plugs" min="0" max="13" value="10" size="3" /></label>
        <label class="check"><input type="checkbox" id="c-rings" /> Random ring settings (hard)</label>
        <label class="check"><input type="checkbox" id="c-offset" /> Tell the student where the crib sits</label>
        <button id="c-generate" class="primary">Generate</button>
      </div>
      <div id="c-out"></div>
    </div>`));
    this.els.cStudent = sec.querySelector('#c-student')!;
    this.els.cOut = sec.querySelector('#c-out')!;
    sec.querySelector('#c-generate')!.addEventListener('click', () => {
      const msg = Number((sec.querySelector('#c-msg') as HTMLSelectElement).value);
      const plugPairs = Number((sec.querySelector('#c-plugs') as HTMLInputElement).value);
      const randomRings = (sec.querySelector('#c-rings') as HTMLInputElement).checked;
      const revealOffset = (sec.querySelector('#c-offset') as HTMLInputElement).checked;
      const c = generateChallenge(Math.floor(Math.random() * 2 ** 31), { plugPairs, randomRings, revealOffset, ...(msg >= 0 ? { message: msg } : {}) });
      const link = location.origin + location.pathname + '#c=' + encodeChallenge(c);
      this.els.cOut.innerHTML = `<div class="stop-detail">
        <div><b>${esc(c.title)}</b> · rotors ${c.settings.rotors.join(' ')}, reflector ${c.settings.reflector}, rings ${c.settings.rings}, positions ${c.settings.positions}, plugs <code>${c.settings.plugboard || 'none'}</code></div>
        <div>Plaintext: <code>${groupFives(c.plaintext)}</code></div>
        <div>Ciphertext: <code>${groupFives(c.ciphertext)}</code></div>
        <div>Crib: <code>${c.crib}</code>${c.offset >= 0 ? ` at offset ${c.offset}` : ' (position not given)'}</div>
        <div class="row"><input id="c-link" class="mono grow" readonly aria-label="Challenge link" value="${esc(link)}" /><button id="c-copy" class="small">Copy link</button><button id="c-open" class="small">Open it here</button></div>
        <p class="muted">The settings ride inside the link, lightly scrambled so they are not readable at a glance; a determined student can decode them. Hand out the link, not this panel.</p>
      </div>`;
      this.els.cOut.querySelector('#c-copy')!.addEventListener('click', () => {
        void navigator.clipboard?.writeText(link);
        (this.els.cOut.querySelector('#c-copy') as HTMLButtonElement).textContent = 'Copied';
      });
      this.els.cOut.querySelector('#c-open')!.addEventListener('click', () => {
        this.challenge = c;
        this.challengeIsStudent = true;
        history.replaceState(null, '', '#c=' + encodeChallenge(c));
        this.renderChallenge();
      });
    });
  }

  private renderChallenge(): void {
    const box = this.els.cStudent;
    const c = this.challenge;
    if (!c || !this.challengeIsStudent) {
      box.innerHTML = '<div class="panel"><h2>Challenge</h2><p class="muted">Open a challenge link to see an intercepted message and its crib here. Instructors generate links below.</p></div>';
      return;
    }
    box.innerHTML = `<div class="panel">
      <h2>Challenge: ${esc(c.title)}</h2>
      <div>Intercepted message (${c.ciphertext.length} letters):</div>
      <pre class="plain">${groupFives(c.ciphertext)}</pre>
      <div>Crib: <code>${c.crib}</code>${c.offset >= 0 ? ` at offset ${c.offset} (0-based)` : ', position unknown, slide it'}</div>
      <p class="muted">Rotors I to V, reflector B, ring settings A unless the challenge is marked hard. Find the rotor order, positions and plugs, decrypt the message, and paste it below.</p>
      <div class="row"><button id="c-attack" class="primary">Open in the Attack tab</button></div>
      <label class="block">Your decryption <textarea id="c-answer" class="mono" rows="2" spellcheck="false"></textarea></label>
      <div class="row"><button id="c-check" class="small">Check</button><button id="c-reveal" class="small">Reveal the settings</button><span id="c-result"></span></div>
      <div id="c-reveal-out"></div>
    </div>`;
    box.querySelector('#c-attack')!.addEventListener('click', () => {
      this.ciphertext = c.ciphertext;
      this.crib = c.crib;
      this.resetAttack();
      if (c.offset >= 0) {
        this.offset = c.offset;
        this.renderAttack();
      }
      this.setTab('attack');
    });
    box.querySelector('#c-check')!.addEventListener('click', () => {
      const g = gradeAnswer(c, (box.querySelector('#c-answer') as HTMLTextAreaElement).value);
      const marks = [...c.plaintext].map((ch, i) => `<span class="${g.marks[i] ? 'ok' : 'bad'}">${g.marks[i] ? ch : (normalizeText((box.querySelector('#c-answer') as HTMLTextAreaElement).value)[i] ?? '·')}</span>`).join('');
      box.querySelector('#c-result')!.innerHTML = g.solved ? `<b class="ok">Solved: all ${g.total} letters.</b>` : `${g.correct} of ${g.total} letters right. <code class="mono">${marks}</code>${g.correct > 0 && g.correct < g.total ? '<span class="muted"> If it is right through the crib and then drifts, the ring settings are not A: shift a ring and the matching position together.</span>' : ''}`;
    });
    box.querySelector('#c-reveal')!.addEventListener('click', () => {
      box.querySelector('#c-reveal-out')!.innerHTML = `<div class="stop-detail"><div>Rotors ${c.settings.rotors.join(' ')}, reflector ${c.settings.reflector}, rings <code>${c.settings.rings}</code>, start positions <code>${c.settings.positions}</code>, plugs <code>${c.settings.plugboard || 'none'}</code>.</div><div>Plaintext: <code>${groupFives(c.plaintext)}</code></div><div class="row"><button id="c-load" class="small">Load into the Machine tab</button></div></div>`;
      box.querySelector('#c-load')!.addEventListener('click', () => {
        this.config = { ...c.settings };
        this.typed = c.plaintext;
        this.viewIndex = -1;
        this.renderMachine();
        this.setTab('machine');
      });
    });
  }
}

function tapeHtml(s: string, view: number): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && i % 5 === 0) out += ' ';
    out += i === view ? `<mark>${s[i]}</mark>` : s[i];
  }
  return out;
}
