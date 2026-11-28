// The browser shell: menus, the game loop, input (keyboard, gamepad, touch),
// overlays, settings and records. All game rules live in src/core.

import { DIFFICULTY, suggest, type Difficulty } from '../core/ai';
import type { Game, GameEvent } from '../core/game';
import { Match } from '../core/match';
import { formatTime, MODE_ORDER, MODES, type ModeId } from '../core/modes';
import { seedFromString } from '../core/rng';
import { KEYS, parseReplay, Session, type Key, type Replay } from '../core/session';
import { browserKV, DEFAULT_SETTINGS, Records, type ScoreEntry, type Settings, type Theme } from '../core/storage';
import { Audio } from './audio';
import { h, clear } from './dom';
import { ageView, burst, drawBoard, drawPreview, newView, type BoardView } from './render';

const FRAME_MS = 1000 / 60;
const KEY_LABEL: Record<Key, string> = {
  left: 'Move left', right: 'Move right', soft: 'Soft drop', hard: 'Hard drop',
  cw: 'Rotate clockwise', ccw: 'Rotate counter-clockwise', r180: 'Rotate 180°', hold: 'Hold',
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyCode(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace(/Left$|Right$/, (m) => ` ${m}`).trim();
}

interface Run {
  session: Session;
  match: Match | null;
  daily: string | null;
  replay: boolean;
  source: Replay | null;
  view: BoardView;
  cpuView: BoardView | null;
  countdown: number;
  paused: boolean;
  speed: number;
  finished: boolean;
}

export class App {
  private readonly records = new Records(browserKV());
  private settings: Settings = this.records.settings();
  private readonly audio = new Audio();
  private run: Run | null = null;
  private acc = 0;
  private last = 0;
  private padPrev = new Map<number, boolean>();
  private els: Record<string, HTMLElement> = {};
  private canvases: Record<string, HTMLCanvasElement> = {};
  private nextCanvases: HTMLCanvasElement[] = [];
  private rebinding: Key | null = null;

  constructor(private readonly root: HTMLElement) {
    this.audio.setVolume(this.settings.volume);
    // The colour theme dresses the board (data-skin); data-theme belongs to the light and dark mode switch.
    document.documentElement.dataset.skin = this.settings.theme;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.autoPause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    this.showMenu();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---- Menu ------------------------------------------------------------------

  private bestText(mode: ModeId): string {
    const best = this.records.scores(mode)[0];
    if (!best) return 'No record yet';
    if (MODES[mode].rankBy === 'time') return best.won ? `Best ${formatTime(best.frames)}` : `Best ${best.lines} lines`;
    return `Best ${best.score.toLocaleString()}`;
  }

  private showMenu(): void {
    this.endRun();
    clear(this.root);
    const daily = this.records.daily(today());
    const lt = this.records.lifetime();
    const startSel = h('select', { id: 'start-level', 'aria-label': 'Marathon start level' },
      Array.from({ length: 15 }, (_, i) => h('option', { value: String(i + 1), selected: this.settings.startLevel === i + 1 }, `Level ${i + 1}`)));
    startSel.addEventListener('change', () => {
      this.settings.startLevel = Number((startSel as HTMLSelectElement).value);
      this.saveSettings();
    });
    const diffSel = h('select', { id: 'difficulty', 'aria-label': 'CPU difficulty' },
      (Object.keys(DIFFICULTY) as Difficulty[]).map((d) => h('option', { value: d, selected: this.settings.difficulty === d }, `CPU: ${DIFFICULTY[d].label}`)));
    diffSel.addEventListener('change', () => {
      this.settings.difficulty = (diffSel as HTMLSelectElement).value as Difficulty;
      this.saveSettings();
    });

    const cards = MODE_ORDER.map((id) => {
      const m = MODES[id];
      const extra = id === 'marathon' ? startSel : id === 'versus' ? diffSel : null;
      const btn = h('button', { class: 'mode-card', 'data-mode': id },
        h('span', { class: 'mode-name' }, m.name),
        h('span', { class: 'mode-blurb' }, m.blurb),
        h('span', { class: 'mode-best' }, this.bestText(id)));
      btn.addEventListener('click', () => this.start(id));
      return h('div', { class: 'mode-wrap' }, btn, extra);
    });

    const dailyBtn = h('button', { class: 'mode-card daily' },
      h('span', { class: 'mode-name' }, `Daily Sprint · ${today()}`),
      h('span', { class: 'mode-blurb' }, 'Everyone gets the same piece sequence today. 40 lines, fastest wins.'),
      h('span', { class: 'mode-best' }, daily?.won ? `Your best today ${formatTime(daily.frames)}` : 'Not played today'));
    dailyBtn.addEventListener('click', () => this.start('sprint', today()));

    const tool = (label: string, fn: () => void) => {
      const b = h('button', { class: 'tool' }, label);
      b.addEventListener('click', fn);
      return b;
    };

    this.root.append(
      h('header', { class: 'menu-head' },
        h('div', { class: 'title-row' },
          h('h1', {}, h('span', { class: 'logo', 'aria-hidden': 'true' }, '▦'), ' Tetromino Arcade'),
          h('hw-theme-toggle', {})),
        h('p', { class: 'tag' }, 'A falling-block puzzle game with modern rules, seven modes, a CPU rival and replays. Runs entirely in your browser.')),
      h('main', { class: 'menu' },
        h('section', { class: 'modes', 'aria-label': 'Game modes' }, h('div', { class: 'mode-wrap' }, dailyBtn), ...cards),
        h('nav', { class: 'tools' },
          tool('How to play', () => this.showHelp()),
          tool('Settings', () => this.showSettings()),
          tool('Records', () => this.showRecords()),
          tool('Replays', () => this.showReplays())),
        h('p', { class: 'lifetime' },
          lt.games
            ? `${lt.games} games · ${formatTime(lt.frames).split('.')[0]} played · ${lt.lines.toLocaleString()} lines · ${lt.tetrises} tetrises · ${lt.tspins} T-spins · ${lt.perfectClears} perfect clears · versus ${lt.versusWins}-${lt.versusLosses}`
            : 'Press a mode to start. Arrow keys move, Up / X rotates, Z rotates back, Space drops, C holds.')),
      h('footer', { class: 'foot' },
        'Tetris-style game made for a portfolio; not affiliated with The Tetris Company. ',
        h('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/tetromino-arcade' }, 'Source')),
    );
    (this.root.querySelector('.mode-card') as HTMLElement | null)?.focus();
  }

  // ---- Starting and ending runs ---------------------------------------------------

  private start(mode: ModeId, daily: string | null = null, replay?: Replay): void {
    this.audio.unlock();
    this.endRun();
    const seed = daily ? seedFromString(`daily:${daily}`) : replay ? replay.seed : (Math.random() * 2 ** 32) >>> 0;
    const handling = this.settings.handling;
    let session: Session;
    let match: Match | null = null;
    if (replay) {
      session = Session.fromReplay(replay);
    } else if (mode === 'versus') {
      match = new Match(seed, this.settings.difficulty, handling);
      session = match.player;
    } else {
      session = new Session({ mode, seed, startLevel: mode === 'marathon' ? this.settings.startLevel : 1 }, handling);
    }
    const view = newView(this.settings.theme);
    this.run = {
      session, match, daily, replay: !!replay, source: replay ?? null, view,
      cpuView: match ? newView(this.settings.theme) : null,
      countdown: replay ? 0 : 3 * 60, paused: false, speed: 1, finished: false,
    };
    this.buildGameScreen();
    if (this.settings.music && !replay) {
      this.audio.startMusic(() => Math.max(90, 220 - (this.run?.session.game.level ?? 1) * 8));
    }
  }

  private endRun(): void {
    this.audio.stopMusic();
    this.run = null;
    this.els = {};
    this.canvases = {};
    this.nextCanvases = [];
  }

  private restart(): void {
    const r = this.run;
    if (!r) return;
    if (r.source) {
      this.start(r.source.mode, null, r.source);
      return;
    }
    this.start(r.session.game.mode.id, r.daily);
  }

  // ---- Game screen -------------------------------------------------------------------

  private buildGameScreen(): void {
    const r = this.run;
    if (!r) return;
    clear(this.root);
    const g = r.session.game;
    const mkCanvas = (cls: string, label: string) => h('canvas', { class: cls, role: 'img', 'aria-label': label }) as HTMLCanvasElement;

    this.canvases.board = mkCanvas('board', 'Playfield');
    this.canvases.hold = mkCanvas('preview', 'Hold piece');
    const nextCount = r.match ? 3 : 5;
    this.nextCanvases = Array.from({ length: nextCount }, (_, i) => mkCanvas(i === 0 ? 'preview first' : 'preview small', `Next piece ${i + 1}`));

    const btn = (label: string, title: string, fn: () => void) => {
      const b = h('button', { class: 'bar-btn', title }, label);
      b.addEventListener('click', () => {
        fn();
        b.blur();
      });
      return b;
    };

    const bar = h('div', { class: 'bar' },
      btn('☰ Menu', 'Back to menu (Esc twice)', () => this.showMenu()),
      h('span', { class: 'bar-title' }, r.replay ? `Replay · ${g.mode.name}` : r.daily ? `Daily Sprint · ${r.daily}` : r.match ? `Versus · CPU ${DIFFICULTY[this.settings.difficulty].label}` : g.mode.name),
      r.replay
        ? h('span', { class: 'speeds' }, ...[0.5, 1, 2, 4].map((s) => btn(`${s}×`, `Replay speed ${s}×`, () => { if (this.run) this.run.speed = s; })))
        : null,
      btn('⏸ Pause', 'Pause (Esc or P)', () => this.togglePause()),
      btn('↻ Restart', 'Restart (R)', () => this.restart()),
    );

    this.els.stats = h('dl', { class: 'stats' });
    this.els.overlay = h('div', { class: 'overlay hidden', role: 'dialog', 'aria-live': 'polite' });
    this.els.progress = h('div', { class: 'progress' + (r.replay ? '' : ' hidden') }, h('div', { class: 'progress-fill' }));

    const left = h('aside', { class: 'side left' },
      h('div', { class: 'panel' }, h('h2', {}, 'Hold'), this.canvases.hold),
      this.els.stats);
    const right = h('aside', { class: 'side right' },
      h('div', { class: 'panel next' }, h('h2', {}, 'Next'), ...this.nextCanvases));
    if (r.match) {
      this.canvases.cpu = mkCanvas('board cpu', 'CPU playfield');
      this.els.cpuStats = h('div', { class: 'cpu-stats' });
      right.append(h('div', { class: 'panel cpu-panel' }, h('h2', {}, 'CPU'), this.canvases.cpu, this.els.cpuStats));
    }

    const center = h('div', { class: 'center' }, this.canvases.board, this.els.overlay, this.els.progress);
    this.attachTouchToBoard(this.canvases.board);

    this.root.append(
      bar,
      h('main', { class: 'game' + (r.match ? ' versus' : '') }, left, center, right),
    );
    if (!r.replay) this.root.append(this.touchPad());
  }

  private touchPad(): HTMLElement {
    const pad = h('div', { class: 'touchpad', 'aria-label': 'Touch controls' });
    const defs: [Key, string][] = [['hold', 'Hold'], ['ccw', '↺'], ['cw', '↻'], ['hard', '⤓'], ['left', '◀'], ['soft', '▼'], ['right', '▶']];
    for (const [k, label] of defs) {
      const b = h('button', { class: `tp tp-${k}`, 'aria-label': KEY_LABEL[k] }, label);
      const down = (e: Event) => {
        e.preventDefault();
        this.audio.unlock();
        this.input(k, true);
      };
      const up = (e: Event) => {
        e.preventDefault();
        this.input(k, false);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      pad.append(b);
    }
    return pad;
  }

  /** Swipe controls on the board: drag to move, tap to rotate, flick down to drop. */
  private attachTouchToBoard(canvas: HTMLCanvasElement): void {
    let start: { x: number; y: number; t: number; moved: number; lastX: number; soft: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.audio.unlock();
      start = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, lastX: e.clientX, soft: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!start) return;
      const cell = canvas.clientWidth / 10;
      const dx = e.clientX - start.lastX;
      if (Math.abs(dx) >= cell) {
        const k: Key = dx < 0 ? 'left' : 'right';
        this.input(k, true);
        this.input(k, false);
        start.lastX += Math.sign(dx) * cell;
        start.moved++;
      }
      if (!start.soft && e.clientY - start.y > cell * 2 && performance.now() - start.t > 250) {
        start.soft = true;
        this.input('soft', true);
      }
    });
    const end = (e: PointerEvent) => {
      if (!start) return;
      const cell = canvas.clientWidth / 10;
      const dt = performance.now() - start.t;
      const dy = e.clientY - start.y;
      if (start.soft) this.input('soft', false);
      else if (dy > cell * 2 && dt < 250) this.tap('hard');
      else if (dy < -cell * 2) this.tap('hold');
      else if (start.moved === 0 && Math.abs(e.clientX - start.x) < cell / 2 && dt < 300) {
        this.tap(e.clientX - canvas.getBoundingClientRect().left < canvas.clientWidth / 2 ? 'ccw' : 'cw');
      }
      start = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private tap(k: Key): void {
    this.input(k, true);
    this.input(k, false);
  }

  // ---- Input -------------------------------------------------------------------------

  private keyFor(code: string): Key | null {
    for (const k of KEYS) if (this.settings.bindings[k].includes(code)) return k;
    return null;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.rebinding && down) {
      e.preventDefault();
      if (e.code !== 'Escape') this.bind(this.rebinding, e.code);
      this.rebinding = null;
      this.showSettings();
      return;
    }
    // The real target: a key in a shadow root (the theme switch's button) reaches window retargeted to its host.
    const target = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && target.getAttribute('type') !== 'range') return;
    const r = this.run;
    if (!r) return;
    if (down && (e.code === 'Escape' || e.code === 'KeyP')) {
      e.preventDefault();
      if (r.finished) this.showMenu();
      else this.togglePause();
      return;
    }
    if (down && e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.restart();
      return;
    }
    if (down && e.code === 'Enter' && r.finished) {
      e.preventDefault();
      this.restart();
      return;
    }
    const k = this.keyFor(e.code);
    if (!k) return;
    e.preventDefault();
    if (down && e.repeat) return;
    this.input(k, down);
  }

  private input(k: Key, down: boolean): void {
    const r = this.run;
    if (!r || r.replay) return;
    if (down) {
      if (r.paused || r.countdown > 0 || r.finished) return;
      r.session.press(k);
    } else {
      r.session.release(k);
    }
  }

  private pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p);
    if (!pad) return;
    const map: [number, Key | 'pause'][] = [
      [14, 'left'], [15, 'right'], [13, 'soft'], [12, 'hard'], [0, 'cw'], [1, 'ccw'], [3, 'r180'], [2, 'hold'], [4, 'hold'], [5, 'hold'], [9, 'pause'],
    ];
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const state = (i: number) => {
      const b = pad.buttons[i]?.pressed ?? false;
      if (i === 14) return b || axisX < -0.5;
      if (i === 15) return b || axisX > 0.5;
      if (i === 13) return b || axisY > 0.6;
      return b;
    };
    for (const [i, k] of map) {
      const now = state(i);
      const before = this.padPrev.get(i) ?? false;
      if (now !== before) {
        if (k === 'pause') {
          if (now) this.togglePause();
        } else {
          this.input(k, now);
        }
      }
      this.padPrev.set(i, now);
    }
  }

  // ---- Loop -------------------------------------------------------------------------

  private loop(t: number): void {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(250, this.last ? t - this.last : FRAME_MS);
    this.last = t;
    const r = this.run;
    if (!r) return;
    this.pollGamepad();
    if (!r.paused && !r.finished) {
      this.acc += dt * r.speed;
      let n = 0;
      while (this.acc >= FRAME_MS && n < 40) {
        this.acc -= FRAME_MS;
        n++;
        this.frame();
        if (this.run !== r || r.finished) break;
      }
    } else {
      this.acc = 0;
    }
    if (this.run === r) this.draw();
  }

  private frame(): void {
    const r = this.run;
    if (!r) return;
    if (r.countdown > 0) {
      if (r.countdown % 60 === 0) this.audio.play('count');
      r.countdown--;
      if (r.countdown === 0) this.audio.play('go');
      return;
    }
    if (r.match) r.match.tick();
    else r.session.tick();
    this.handleEvents(r.session.game, r.view, true);
    if (r.match && r.cpuView) this.handleEvents(r.match.cpuGame, r.cpuView, false);
    ageView(r.view);
    if (r.cpuView) ageView(r.cpuView);
    const over = r.match ? r.match.over : r.session.game.over;
    if (over) this.finish();
  }

  private handleEvents(g: Game, view: BoardView, sound: boolean): void {
    const events: GameEvent[] = g.events.splice(0, g.events.length);
    const s = this.settings;
    for (const e of events) {
      switch (e.type) {
        case 'move':
          if (sound) this.audio.play('move');
          break;
        case 'rotate':
          if (sound) this.audio.play(e.spin ? 'tspin' : 'rotate');
          break;
        case 'hold':
          if (sound) this.audio.play('hold');
          break;
        case 'harddrop':
          if (sound) this.audio.play('drop');
          if (s.shake && e.distance > 2) view.shake = Math.max(view.shake, 3);
          break;
        case 'lock': {
          const n = e.lines.length;
          if (n > 0) {
            view.flash = { rows: e.lines, life: 12 };
            if (s.particles) burst(view, e.lines, n === 4 || e.spin !== 'none' ? 3 : 1);
            if (s.shake && (n === 4 || e.perfect)) view.shake = 8;
            if (sound) this.audio.play(e.spin !== 'none' ? 'tspin' : n === 4 ? 'tetris' : 'clear');
          } else if (sound) {
            this.audio.play('lock');
          }
          if (e.label) view.popup = { text: e.label, sub: e.points ? `+${e.points.toLocaleString()}` : '', life: 70 };
          break;
        }
        case 'levelup':
          if (sound) this.audio.play('levelup');
          if (!view.popup) view.popup = { text: `Level ${e.level}`, sub: '', life: 60 };
          break;
        case 'garbage':
          if (sound) this.audio.play('garbage');
          if (s.shake) view.shake = Math.max(view.shake, 4);
          break;
        case 'zenreset':
          view.popup = { text: 'Field cleared', sub: 'Zen never ends', life: 80 };
          break;
        case 'spawn':
        case 'end':
          break;
      }
    }
  }

  // ---- Drawing -------------------------------------------------------------------------

  private draw(): void {
    const r = this.run;
    if (!r || !this.canvases.board) return;
    const g = r.session.game;
    const s = this.settings;
    r.view.ghost = s.ghost;
    r.view.grid = s.grid;
    r.view.theme = s.theme;
    r.view.hint = s.hint && !r.replay && g.active ? hintFor(g) : null;
    drawBoard(this.canvases.board, g, r.view, g.pendingGarbage());
    drawPreview(this.canvases.hold, g.hold, s.theme, g.holdUsed);
    const next = g.next;
    this.nextCanvases.forEach((c, i) => drawPreview(c, next[i] ?? null, s.theme));
    if (r.match && r.cpuView && this.canvases.cpu) {
      const cg = r.match.cpuGame;
      r.cpuView.theme = s.theme;
      r.cpuView.grid = s.grid;
      drawBoard(this.canvases.cpu, cg, r.cpuView, cg.pendingGarbage());
      this.setText(this.els.cpuStats, `${cg.lines} lines · ${cg.stats.attackSent} sent`);
    }
    this.renderStats(r);
    if (r.replay) {
      const fill = this.els.progress.firstElementChild as HTMLElement;
      fill.style.width = `${(r.session.progress() * 100).toFixed(1)}%`;
    }
    if (r.countdown > 0 && !r.paused) {
      this.showOverlay([h('div', { class: 'count' }, String(Math.ceil(r.countdown / 60)))], 'countdown');
    } else if (!r.paused && !r.finished) {
      this.hideOverlay();
    }
  }

  private setText(el: HTMLElement | undefined, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
  }

  private renderStats(r: Run): void {
    const g = r.session.game;
    const secs = Math.max(g.seconds(), 1 / 60);
    const rows: [string, string][] = [];
    const m = g.mode;
    if (m.timeLimitFrames) rows.push(['Time left', formatTime(Math.max(0, m.timeLimitFrames - g.frame))]);
    else rows.push(['Time', formatTime(g.frame)]);
    if (m.id !== 'sprint' && m.id !== 'dig') rows.push(['Score', g.score.toLocaleString()]);
    if (m.goalLines) rows.push(['Lines', `${g.lines} / ${m.goalLines}`]);
    else rows.push(['Lines', String(g.lines)]);
    if (m.id === 'dig') rows.push(['Garbage left', String(g.garbageLeft)]);
    if (m.fixedLevel === undefined) rows.push(['Level', String(g.level)]);
    rows.push(['Pieces', String(g.stats.pieces)]);
    rows.push(['PPS', (g.stats.pieces / secs).toFixed(2)]);
    if (r.match) rows.push(['Attack', `${g.stats.attackSent} (${((g.stats.attackSent / secs) * 60).toFixed(1)} APM)`]);
    if (g.combo > 0) rows.push(['Combo', String(g.combo)]);
    if (g.b2b > 1) rows.push(['Back-to-back', `×${g.b2b - 1}`]);
    const key = rows.map((x) => x.join(':')).join('|');
    const el = this.els.stats;
    if (!el || el.dataset.key === key) return;
    el.dataset.key = key;
    clear(el);
    for (const [k, v] of rows) el.append(h('dt', {}, k), h('dd', {}, v));
  }

  // ---- Overlays -------------------------------------------------------------------------

  private showOverlay(children: (Node | null)[], kind: string): void {
    const o = this.els.overlay;
    if (!o) return;
    if (o.dataset.kind === kind && kind === 'countdown') {
      const c = o.querySelector('.count');
      const text = (children[0] as HTMLElement).textContent ?? '';
      if (c && c.textContent !== text) c.textContent = text;
      return;
    }
    o.dataset.kind = kind;
    clear(o);
    o.append(h('div', { class: `overlay-box ov-${kind}` }, ...children));
    o.classList.remove('hidden');
    (o.querySelector('button') as HTMLElement | null)?.focus();
  }

  private hideOverlay(): void {
    const o = this.els.overlay;
    if (!o || o.classList.contains('hidden')) return;
    o.classList.add('hidden');
    o.dataset.kind = '';
    clear(o);
  }

  private autoPause(): void {
    const r = this.run;
    if (r && !r.paused && !r.finished && !r.replay) this.togglePause();
  }

  private togglePause(): void {
    const r = this.run;
    if (!r || r.finished) return;
    r.paused = !r.paused;
    r.session.releaseAll();
    if (r.paused) {
      this.audio.stopMusic();
      const resume = h('button', { class: 'primary' }, 'Resume');
      resume.addEventListener('click', () => this.togglePause());
      const restart = h('button', {}, 'Restart');
      restart.addEventListener('click', () => this.restart());
      const settings = h('button', {}, 'Settings');
      settings.addEventListener('click', () => this.showSettings());
      const menu = h('button', {}, 'Quit to menu');
      menu.addEventListener('click', () => this.showMenu());
      this.showOverlay([h('h2', {}, 'Paused'), h('p', { class: 'muted' }, 'Esc or P to resume'), resume, restart, settings, menu], 'pause');
    } else {
      this.hideOverlay();
      if (this.settings.music && !r.replay) this.audio.startMusic(() => Math.max(90, 220 - (this.run?.session.game.level ?? 1) * 8));
    }
  }

  private finish(): void {
    const r = this.run;
    if (!r || r.finished) return;
    r.finished = true;
    r.session.releaseAll();
    this.audio.stopMusic();
    const g = r.session.game;
    const versusResult = r.match ? (r.match.winner === 'player' ? 'win' : 'loss') : undefined;
    const won = r.match ? versusResult === 'win' : g.won;
    this.audio.play(won ? 'win' : 'gameover');

    let rankNote = '';
    let replay: Replay | null = null;
    if (!r.replay) {
      this.records.recordGame(g.frame, g.lines, g.stats, versusResult);
      const entry: ScoreEntry = {
        name: this.settings.name || 'Player', score: g.score, lines: g.lines, frames: g.frame,
        level: g.level, won, date: new Date().toISOString(),
      };
      if (!r.match) replay = r.session.toReplay();
      if (r.daily) {
        if (this.records.saveDaily(r.daily, entry) && won) rankNote = 'New best for today\'s Daily Sprint!';
      } else if (won || (!r.match && g.mode.rankBy === 'score')) {
        const rank = this.records.addScore(g.mode.id, entry);
        if (rank === 0) {
          rankNote = 'New personal best!';
          if (replay) this.records.saveBestReplay(g.mode.id, replay);
        } else if (rank > 0) {
          rankNote = `Ranked #${rank + 1} in your ${g.mode.name} records`;
        }
      }
    }

    const secs = Math.max(g.seconds(), 1 / 60);
    const title = r.match ? (won ? 'You win!' : 'CPU wins') : g.mode.endless ? 'Session over' : won ? 'Complete!' : 'Game over';
    const statRows: [string, string][] = [
      ['Result', r.match ? `${title} (${r.match.winner === 'player' ? r.match.cpuGame.endReason : g.endReason})` : g.endReason || '—'],
      ['Time', formatTime(g.frame)],
      ['Score', g.score.toLocaleString()],
      ['Lines', String(g.lines)],
      ['Level', String(g.level)],
      ['Pieces', `${g.stats.pieces} (${(g.stats.pieces / secs).toFixed(2)} per second)`],
      ['Keys per piece', g.stats.pieces ? (g.stats.inputs / g.stats.pieces).toFixed(2) : '—'],
      ['Clears', `${g.stats.clears[1]} singles · ${g.stats.clears[2]} doubles · ${g.stats.clears[3]} triples · ${g.stats.clears[4]} tetrises`],
      ['T-spins', String(g.stats.tspins)],
      ['Max combo', String(Math.max(0, g.stats.maxCombo))],
      ['Perfect clears', String(g.stats.perfectClears)],
    ];
    if (r.match) statRows.push(['Attack', `${g.stats.attackSent} sent · ${g.stats.garbageReceived} received`]);

    const buttons: HTMLElement[] = [];
    const add = (label: string, fn: () => void, primary = false) => {
      const b = h('button', primary ? { class: 'primary' } : {}, label);
      b.addEventListener('click', fn);
      buttons.push(b);
    };
    add(r.replay ? 'Watch again' : 'Play again (Enter)', () => this.restart(), true);
    if (replay) {
      const rep = replay;
      add('Watch replay', () => this.start(rep.mode, null, rep));
      add('Download replay', () => downloadJson(`tetromino-${rep.mode}-${rep.date.slice(0, 10)}.json`, rep));
    }
    add('Copy result', () => {
      const text = `Tetromino Arcade · ${r.daily ? `Daily Sprint ${r.daily}` : g.mode.name} · ${title} · ${formatTime(g.frame)} · ${g.score.toLocaleString()} pts · ${g.lines} lines · ${(g.stats.pieces / secs).toFixed(2)} PPS`;
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    });
    add('Menu (Esc)', () => this.showMenu());

    this.showOverlay([
      h('h2', {}, title),
      rankNote ? h('p', { class: 'rank' }, rankNote) : null,
      h('dl', { class: 'results' }, ...statRows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('div', { class: 'buttons' }, ...buttons),
    ], 'results');
  }

  // ---- Modals ------------------------------------------------------------------------------

  private modal(title: string, body: (Node | null)[], onClose?: () => void): HTMLElement {
    document.querySelector('.modal-back')?.remove();
    const close = h('button', { class: 'close', 'aria-label': 'Close' }, '✕');
    const back = h('div', { class: 'modal-back' },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('h2', {}, title), close),
        // The body scrolls when it is taller than the dialog (How to play): a named region the keyboard can reach.
        h('div', { class: 'modal-body', tabindex: '0', role: 'region', 'aria-label': title }, ...body)));
    const done = () => {
      back.remove();
      this.rebinding = null;
      onClose?.();
    };
    close.addEventListener('click', done);
    back.addEventListener('click', (e) => {
      if (e.target === back) done();
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.rebinding) {
        e.stopPropagation();
        done();
      }
    });
    document.body.append(back);
    close.focus();
    return back;
  }

  private saveSettings(): void {
    this.records.saveSettings(this.settings);
  }

  private bind(k: Key, code: string): void {
    for (const other of KEYS) this.settings.bindings[other] = this.settings.bindings[other].filter((c) => c !== code);
    this.settings.bindings[k] = [code, ...this.settings.bindings[k]].slice(0, 2);
    this.saveSettings();
  }

  private showSettings(): void {
    const s = this.settings;
    const range = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void) => {
      const out = h('output', {}, fmt(value));
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label }) as HTMLInputElement;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        set(v);
        out.textContent = fmt(v);
        this.saveSettings();
      });
      return h('label', { class: 'row' }, h('span', {}, label), input, out);
    };
    const check = (label: string, value: boolean, set: (v: boolean) => void) => {
      const input = h('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
      input.addEventListener('change', () => {
        set(input.checked);
        this.saveSettings();
      });
      return h('label', { class: 'row check' }, input, h('span', {}, label));
    };
    const ms = (f: number) => `${Math.round(f * FRAME_MS)} ms`;

    const bindRows = KEYS.map((k) => {
      const change = h('button', { class: 'small' }, this.rebinding === k ? 'Press a key…' : 'Change');
      change.addEventListener('click', () => {
        this.rebinding = k;
        change.textContent = 'Press a key… (Esc cancels)';
      });
      return h('div', { class: 'row bind' }, h('span', {}, KEY_LABEL[k]),
        h('span', { class: 'keys' }, ...s.bindings[k].map((c) => h('kbd', {}, prettyCode(c)))), change);
    });

    const themeSel = h('select', { 'aria-label': 'Colour theme' },
      (['classic', 'neon', 'pastel', 'mono'] as Theme[]).map((t) => h('option', { value: t, selected: s.theme === t }, t[0].toUpperCase() + t.slice(1)))) as HTMLSelectElement;
    themeSel.addEventListener('change', () => {
      s.theme = themeSel.value as Theme;
      document.documentElement.dataset.skin = s.theme;
      this.saveSettings();
    });
    const name = h('input', { type: 'text', value: s.name, maxlength: '16', 'aria-label': 'Player name' }) as HTMLInputElement;
    name.addEventListener('change', () => {
      s.name = name.value.trim().slice(0, 16) || 'Player';
      this.saveSettings();
    });
    const reset = h('button', {}, 'Restore defaults');
    reset.addEventListener('click', () => {
      this.settings = structuredClone({ ...DEFAULT_SETTINGS, name: s.name });
      this.audio.setVolume(this.settings.volume);
      document.documentElement.dataset.skin = this.settings.theme;
      this.saveSettings();
      this.showSettings();
    });

    this.modal('Settings', [
      h('h3', {}, 'Handling'),
      h('p', { class: 'muted' }, 'Takes effect from the next game. DAS is how long a direction is held before it repeats; ARR is the repeat speed (0 = jump to the wall).'),
      range('DAS', 1, 20, 1, s.handling.das, ms, (v) => (s.handling.das = v)),
      range('ARR', 0, 6, 1, s.handling.arr, (v) => (v === 0 ? 'Instant' : ms(v)), (v) => (s.handling.arr = v)),
      range('Soft drop speed', 5, 41, 1, s.handling.sdf, (v) => (v >= 41 ? 'Instant' : `${v}×`), (v) => (s.handling.sdf = v)),
      h('h3', {}, 'Controls'),
      ...bindRows,
      h('p', { class: 'muted' }, 'Esc / P pause, R restart. Gamepads work too: D-pad moves, A/B rotate, Y rotates 180°, X or bumpers hold, Start pauses. On touch screens use the buttons, or drag on the field, tap to rotate and flick down to drop.'),
      h('h3', {}, 'Display'),
      h('label', { class: 'row' }, h('span', {}, 'Theme'), themeSel),
      check('Ghost piece', s.ghost, (v) => (s.ghost = v)),
      check('Grid lines', s.grid, (v) => (s.grid = v)),
      check('Placement hint (dashed outline of the CPU\'s suggestion)', s.hint, (v) => (s.hint = v)),
      check('Particles', s.particles, (v) => (s.particles = v)),
      check('Screen shake', s.shake, (v) => (s.shake = v)),
      h('h3', {}, 'Sound'),
      range('Volume', 0, 1, 0.05, s.volume, (v) => `${Math.round(v * 100)}%`, (v) => {
        s.volume = v;
        this.audio.setVolume(v);
      }),
      check('Background music', s.music, (v) => (s.music = v)),
      h('h3', {}, 'Player'),
      h('label', { class: 'row' }, h('span', {}, 'Name for records'), name),
      h('div', { class: 'buttons' }, reset),
    ]);
  }

  private showRecords(): void {
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const table = h('div', { class: 'records' });
    const showMode = (id: ModeId) => {
      tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === id)));
      clear(table);
      const list = this.records.scores(id);
      if (list.length === 0) {
        table.append(h('p', { class: 'muted' }, 'No games yet.'));
        return;
      }
      const time = MODES[id].rankBy === 'time';
      table.append(h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Name'), h('th', {}, time ? 'Time' : 'Score'), h('th', {}, 'Lines'), h('th', {}, 'Date'))),
        h('tbody', {}, ...list.map((e, i) => h('tr', {},
          h('td', {}, String(i + 1)), h('td', {}, e.name),
          h('td', {}, time ? (e.won ? formatTime(e.frames) : 'DNF') : e.score.toLocaleString()),
          h('td', {}, String(e.lines)), h('td', {}, e.date.slice(0, 10)))))));
    };
    for (const id of MODE_ORDER) {
      const b = h('button', { role: 'tab', 'data-mode': id }, MODES[id].name);
      b.addEventListener('click', () => showMode(id));
      tabs.append(b);
    }
    const lt = this.records.lifetime();
    const clearBtn = h('button', {}, 'Clear all records');
    clearBtn.addEventListener('click', () => {
      if (confirm('Delete every high score? Lifetime stats are kept.')) {
        this.records.clearScores();
        showMode('marathon');
      }
    });
    this.modal('Records', [
      tabs, table,
      h('h3', {}, 'Lifetime'),
      h('dl', { class: 'results' },
        ...([
          ['Games', lt.games], ['Time played', formatTime(lt.frames).split('.')[0]], ['Pieces', lt.pieces], ['Lines', lt.lines],
          ['Tetrises', lt.tetrises], ['T-spins', lt.tspins], ['Perfect clears', lt.perfectClears], ['Best combo', lt.bestCombo],
          ['Versus', `${lt.versusWins} won, ${lt.versusLosses} lost`],
        ] as [string, string | number][]).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])),
      h('div', { class: 'buttons' }, clearBtn),
    ], () => this.refreshMenu());
    showMode('marathon');
  }

  private showReplays(): void {
    const rows = MODE_ORDER.filter((id) => id !== 'versus').map((id) => {
      const rep = this.records.bestReplay(id);
      const watch = h('button', { class: 'small', disabled: !rep }, 'Watch');
      watch.addEventListener('click', () => {
        document.querySelector('.modal-back')?.remove();
        if (rep) this.start(rep.mode, null, rep);
      });
      const dl = h('button', { class: 'small', disabled: !rep }, 'Download');
      dl.addEventListener('click', () => rep && downloadJson(`tetromino-${id}-best.json`, rep));
      return h('div', { class: 'row bind' }, h('span', {}, MODES[id].name),
        h('span', { class: 'muted' }, rep ? `${MODES[id].rankBy === 'time' ? formatTime(rep.frames) : rep.score.toLocaleString()} · ${rep.date.slice(0, 10)}` : 'none yet'),
        h('span', {}, watch, ' ', dl));
    });
    const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Load replay file' }) as HTMLInputElement;
    const err = h('p', { class: 'error', role: 'alert' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const rep = parseReplay(await f.text());
        document.querySelector('.modal-back')?.remove();
        this.start(rep.mode, null, rep);
      } catch (e) {
        err.textContent = (e as Error).message;
      }
    });
    this.modal('Replays', [
      h('p', { class: 'muted' }, 'Your best run in each mode is saved automatically. A replay is just the seed plus every key press, so files are tiny and play back exactly.'),
      ...rows,
      h('h3', {}, 'Load a replay file'),
      file, err,
    ]);
  }

  private showHelp(): void {
    const b = this.settings.bindings;
    const keys = (k: Key) => b[k].map(prettyCode).join(' / ');
    this.modal('How to play', [
      h('p', {}, 'Pieces fall into a 10-wide well. Fill a whole row to clear it. The game ends when a new piece cannot appear.'),
      h('h3', {}, 'Controls'),
      h('dl', { class: 'results' },
        ...KEYS.flatMap((k) => [h('dt', {}, KEY_LABEL[k]), h('dd', {}, keys(k))]),
        h('dt', {}, 'Pause / restart'), h('dd', {}, 'Esc or P / R')),
      h('h3', {}, 'Rules'),
      h('ul', {},
        h('li', {}, 'Super Rotation System with wall kicks, so pieces can rotate off walls and into tight slots.'),
        h('li', {}, '7-bag randomizer: every seven pieces contain one of each shape.'),
        h('li', {}, 'Hold swaps the current piece out once per drop. The ghost shows where the piece will land.'),
        h('li', {}, 'A grounded piece locks after half a second; moving or rotating resets that timer up to 15 times.')),
      h('h3', {}, 'Scoring (times your level)'),
      h('ul', {},
        h('li', {}, 'Single 100, Double 300, Triple 500, Tetris (4 lines) 800.'),
        h('li', {}, 'T-spin: rotate a T into a slot with three corners filled. T-spin Single 800, Double 1200, Triple 1600; minis are worth less.'),
        h('li', {}, 'Back-to-back Tetrises or T-spins score 1.5×. Consecutive clears build a combo (+50 × combo).'),
        h('li', {}, 'Perfect clear (empty field) adds a big bonus. Soft drop 1 point per row, hard drop 2.')),
      h('h3', {}, 'Versus'),
      h('p', {}, 'Doubles send 1 garbage row, triples 2, Tetrises 4, T-spin doubles 4, plus back-to-back and combo bonuses. Clearing lines first cancels garbage headed your way (the red bar).'),
    ]);
  }

  private refreshMenu(): void {
    if (!this.run) this.showMenu();
  }
}

function hintFor(g: Game) {
  // Cache by piece so the search runs once per piece, not every frame.
  const key = `${g.pieceId}:${g.active?.type}`;
  if (hintCache.key !== key) {
    hintCache.key = key;
    hintCache.piece = suggest(g);
  }
  return hintCache.piece;
}
const hintCache: { key: string; piece: ReturnType<typeof suggest> } = { key: '', piece: null };

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
