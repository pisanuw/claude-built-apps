import type { CardState, Progress, ShortcutSet } from '../core/types';
import { ComboMatcher, chordCandidates, displayCombo, comboForPlatform, formatChord } from '../core/keys';
import { gradeAttempt, review, initialCard } from '../core/sm2';
import { buildQueue, queueCounts, type QueueItem } from '../core/scheduler';
import { computeStreak, recordDay } from '../core/streak';
import { setStats, radarPoints, radarAxes, type SetStats } from '../core/stats';
import { STORAGE_KEY, deserialize, serialize, allSets } from '../core/store';
import { validateSet } from '../core/library';
import { bundledSets } from '../data/sets';
import { dayNumber, isoDate } from '../core/dates';

type Tab = 'practice' | 'stats' | 'sets';

interface SessionItem extends QueueItem {
  /** Re-queued after a failure: practice again, but don't re-schedule. */
  relearn: boolean;
}

interface Session {
  setId: string;
  queue: SessionItem[];
  index: number;
  matcher: ComboMatcher;
  combo: string;
  startedAt: number;
  wrongThisCard: boolean;
  revealed: boolean;
  reviewed: number;
  correct: number;
  /** Chords entered so far for multi-chord combos, for display. */
  entered: string[];
}

const SAMPLE_SET = `{
  "version": 1,
  "id": "my-tool",
  "name": "My tool shortcuts",
  "tool": "My Tool",
  "shortcuts": [
    { "id": "do-thing", "task": "Do the thing", "combo": "Ctrl+Shift+K" },
    { "id": "chord", "task": "A two-chord shortcut", "combo": "Ctrl+K Ctrl+S" },
    { "id": "mac-differs", "task": "Different on macOS", "combo": "Ctrl+L", "mac": "Meta+K" }
  ]
}`;

export class App {
  private progress: Progress;
  private tab: Tab = 'practice';
  private session: Session | null = null;
  private feedback: { kind: 'good' | 'bad' | 'hint'; text: string } | null = null;
  private uploadMessages: { errors: string[]; warnings: string[] } | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.progress = this.load();
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.render();
  }

  private load(): Progress {
    let text: string | null = null;
    try {
      text = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode): run in-memory.
    }
    const p = deserialize(text);
    if (text === null) {
      p.settings.macMode = /Mac|iPhone|iPad/.test(navigator.platform ?? '');
    }
    return p;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(this.progress));
    } catch {
      // Best effort; in-memory progress still works for the session.
    }
  }

  private get mac(): boolean {
    return this.progress.settings.macMode;
  }

  private sets(): ShortcutSet[] {
    return allSets(bundledSets, this.progress);
  }

  private currentSet(): ShortcutSet {
    const sets = this.sets();
    return sets.find((s) => s.id === this.progress.settings.setId) ?? sets[0];
  }

  // ---------- session ----------

  private startSession(): void {
    const set = this.currentSet();
    const cards = this.progress.cards[set.id] ?? {};
    const today = dayNumber(new Date());
    const queue = buildQueue(set.shortcuts, cards, today, this.progress.settings.newPerDay).map((q) => ({
      ...q,
      relearn: false,
    }));
    if (queue.length === 0) {
      this.session = null;
      this.feedback = { kind: 'good', text: 'All caught up — nothing due today. Come back tomorrow!' };
      this.render();
      return;
    }
    this.session = {
      setId: set.id,
      queue,
      index: 0,
      matcher: new ComboMatcher('A'),
      combo: 'A',
      startedAt: 0,
      wrongThisCard: false,
      revealed: false,
      reviewed: 0,
      correct: 0,
      entered: [],
    };
    this.armCurrent();
    this.feedback = null;
    this.render();
  }

  private armCurrent(): void {
    const s = this.session;
    if (!s) return;
    const item = s.queue[s.index];
    const set = this.currentSet();
    const combo = comboForPlatform(item.shortcut, this.mac && set.notation !== 'vim');
    s.combo = combo;
    s.matcher = new ComboMatcher(combo);
    s.startedAt = performance.now();
    s.wrongThisCard = false;
    s.revealed = false;
    s.entered = [];
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.tab !== 'practice' || !this.session) return;
    // The real target: a key in a shadow root (the theme switch's button) reaches window retargeted to its host.
    const target = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    // On the theme switch, Enter and Space press it and Tab leaves it; any other key still answers the card.
    if (
      (e.target as Element | null)?.closest?.('hw-theme-toggle') &&
      ['Enter', ' ', 'Tab'].includes(e.key) &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    )
      return;
    const s = this.session;
    if (s.index >= s.queue.length) return;
    if (s.revealed) {
      // Any key advances after a reveal.
      e.preventDefault();
      this.advance();
      return;
    }
    const candidates = chordCandidates(e);
    if (candidates.length === 0) return;
    e.preventDefault();
    const state = s.matcher.feed(candidates);
    if (state === 'matched') {
      this.finishCard(false);
    } else if (state === 'pending') {
      s.entered.push(formatChord(candidates[0]));
      this.render();
    } else {
      this.failAttempt();
    }
  }

  private failAttempt(): void {
    const s = this.session!;
    const item = s.queue[s.index];
    s.entered = [];
    s.matcher.reset();
    if (!s.wrongThisCard) {
      s.wrongThisCard = true;
      const hint = item.shortcut.hint;
      this.feedback = hint
        ? { kind: 'hint', text: `Not quite — hint: ${hint}` }
        : { kind: 'bad', text: 'Not quite — try again.' };
    } else {
      this.reveal();
      return;
    }
    this.render();
  }

  private reveal(): void {
    const s = this.session!;
    s.revealed = true;
    this.finishCard(true);
  }

  private finishCard(revealed: boolean): void {
    const s = this.session!;
    const item = s.queue[s.index];
    const elapsed = performance.now() - s.startedAt;
    const set = this.currentSet();
    const vim = set.notation === 'vim';

    if (!item.relearn) {
      const quality = gradeAttempt(!s.wrongThisCard, revealed, elapsed);
      const today = dayNumber(new Date());
      const cards = (this.progress.cards[s.setId] ??= {});
      const card: CardState = cards[item.shortcut.id] ?? initialCard(today);
      cards[item.shortcut.id] = review(card, quality, today);
      this.progress.days = recordDay(this.progress.days, isoDate(new Date()));
      s.reviewed += 1;
      if (quality >= 3) s.correct += 1;
      if (quality < 3) {
        s.queue.push({ ...item, relearn: true });
      }
      this.save();
    } else if (revealed) {
      // Failed the relearn repeat too: repeat again until it sticks.
      s.queue.push({ ...item, relearn: true });
    }

    if (revealed) {
      const shown = displayCombo(s.combo, { mac: this.mac && !vim, vim });
      this.feedback = { kind: 'bad', text: `The answer is ${shown} — press any key to continue.` };
      this.render();
      return;
    }
    this.feedback = { kind: 'good', text: 'Correct!' };
    this.advance();
  }

  private advance(): void {
    const s = this.session!;
    s.index += 1;
    if (s.index < s.queue.length) {
      this.armCurrent();
    }
    this.render();
  }

  // ---------- rendering ----------

  private render(): void {
    this.root.textContent = '';
    const wrap = el('div', 'wrap');
    wrap.append(this.renderHeader(), this.renderTabs());
    if (this.tab === 'practice') wrap.append(...this.renderPractice());
    else if (this.tab === 'stats') wrap.append(...this.renderStats());
    else wrap.append(...this.renderSets());
    const foot = el('footer', 'foot');
    const repo = document.createElement('a');
    repo.href = 'https://github.com/pisanuw/Claude-capstone/tree/main/shortcut-sprint';
    repo.textContent = 'source';
    foot.append('Shortcut Sprint — SM-2 spaced repetition, entirely in your browser. ', repo);
    wrap.append(foot);
    this.root.append(wrap);
  }

  private renderHeader(): HTMLElement {
    const h = el('header', 'top');
    const title = document.createElement('h1');
    const zap = el('span', 'zap');
    zap.textContent = '⌨';
    title.append(zap, ' Shortcut Sprint');
    // The light and dark mode switch ends the title row (platform/src/theme).
    const row = el('div', 'title-row');
    row.append(title, document.createElement('hw-theme-toggle'));
    const streak = computeStreak(this.progress.days, isoDate(new Date()));
    const badge = el('div', 'streak');
    badge.textContent = streak > 0 ? `🔥 ${streak}-day streak` : 'no streak yet';
    h.append(row, badge);
    return h;
  }

  private renderTabs(): HTMLElement {
    const nav = el('nav', 'tabs');
    const tabs: [Tab, string][] = [
      ['practice', 'Practice'],
      ['stats', 'Stats'],
      ['sets', 'Sets'],
    ];
    for (const [id, label] of tabs) {
      const b = document.createElement('button');
      b.textContent = label;
      if (this.tab === id) b.className = 'active';
      b.addEventListener('click', () => {
        this.tab = id;
        this.feedback = null;
        this.render();
      });
      nav.append(b);
    }
    return nav;
  }

  private renderPractice(): HTMLElement[] {
    const set = this.currentSet();
    const panel = el('div', 'panel');
    const s = this.session;

    if (!s || s.setId !== set.id) {
      const card = el('div', 'prompt-card');
      const tool = el('div', 'tool');
      tool.textContent = set.name;
      const cards = this.progress.cards[set.id] ?? {};
      const today = dayNumber(new Date());
      const preview = buildQueue(set.shortcuts, cards, today, this.progress.settings.newPerDay);
      const counts = queueCounts(preview);
      const task = el('div', 'task');
      task.textContent =
        preview.length === 0
          ? 'All caught up — nothing due today.'
          : `${counts.due} due · ${counts.fresh} new`;
      const actions = el('div', 'actions');
      if (preview.length > 0) {
        const btn = el('button', 'btn primary') as HTMLButtonElement;
        btn.textContent = 'Start session';
        btn.addEventListener('click', () => this.startSession());
        actions.append(btn);
      }
      card.append(tool, task, actions);
      if (this.feedback) card.append(this.renderFeedback());
      panel.append(card);
      return [panel];
    }

    if (s.index >= s.queue.length) {
      const done = el('div', 'done-card');
      const big = el('div', 'big');
      big.textContent = '🏁';
      const msg = el('div', 'task');
      const pct = s.reviewed === 0 ? 0 : Math.round((s.correct / s.reviewed) * 100);
      msg.textContent = `Session complete: ${s.correct}/${s.reviewed} first-pass correct (${pct}%).`;
      const actions = el('div', 'actions');
      const again = el('button', 'btn') as HTMLButtonElement;
      again.textContent = 'Check for more';
      again.addEventListener('click', () => this.startSession());
      actions.append(again);
      done.append(big, msg, actions);
      panel.append(done);
      return [panel];
    }

    const item = s.queue[s.index];
    const meta = el('div', 'session-meta');
    const remaining = s.queue.length - s.index;
    meta.append(
      metaItem('set', set.name),
      metaItem('remaining', String(remaining)),
      metaItem('card', item.relearn ? 'relearn' : item.isNew ? 'new' : 'review'),
    );

    const card = el('div', 'prompt-card');
    const tool = el('div', 'tool');
    tool.textContent = set.tool;
    const task = el('div', 'task');
    task.textContent = item.shortcut.task;
    const capture = el('div', 'capture');
    if (s.entered.length > 0) {
      for (const chord of s.entered) {
        const k = document.createElement('kbd');
        k.textContent = chord;
        capture.append(k);
      }
      const more = el('span', 'placeholder');
      more.textContent = '… keep going';
      capture.append(more);
    } else {
      const ph = el('span', 'placeholder');
      ph.textContent = 'press the shortcut';
      capture.append(ph);
    }
    card.append(tool, task, capture, this.renderFeedback());

    const actions = el('div', 'actions');
    const revealBtn = el('button', 'btn') as HTMLButtonElement;
    revealBtn.textContent = 'Show answer';
    revealBtn.disabled = s.revealed;
    revealBtn.addEventListener('click', () => {
      if (!s.revealed) this.reveal();
    });
    actions.append(revealBtn);
    card.append(actions);
    panel.append(meta, card);
    return [panel];
  }

  private renderFeedback(): HTMLElement {
    const f = el('div', 'feedback');
    if (this.feedback) {
      f.classList.add(this.feedback.kind);
      f.textContent = this.feedback.text;
    }
    return f;
  }

  private renderStats(): HTMLElement[] {
    const panel = el('div', 'panel');
    const sets = this.sets();
    const stats: SetStats[] = sets.map((s) => setStats(s, this.progress.cards[s.id]));

    const radar = el('div', 'radar-box');
    radar.innerHTML = radarSvg(stats);
    panel.append(radar);

    const table = document.createElement('table');
    table.className = 'stats';
    table.innerHTML =
      '<thead><tr><th>Set</th><th>Started</th><th>Mature</th><th>Mastery</th><th>Accuracy</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (let i = 0; i < sets.length; i += 1) {
      const st = stats[i];
      const tr = document.createElement('tr');
      appendCells(tr, [
        sets[i].name,
        `${st.started}/${st.total}`,
        `${st.mature}/${st.total}`,
        `${Math.round(st.mastery * 100)}%`,
        st.started === 0 ? '—' : `${Math.round(st.accuracy * 100)}%`,
      ]);
      tbody.append(tr);
    }
    table.append(tbody);
    // At phone widths the five columns are wider than the panel: the table scrolls sideways in its own box,
    // which the keyboard can reach (WCAG 1.4.10; axe: scrollable-region-focusable).
    const scroll = el('div', 'table-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Progress per set');
    scroll.append(table);
    panel.append(scroll);

    const streak = computeStreak(this.progress.days, isoDate(new Date()));
    const note = el('p', 'note');
    note.textContent =
      `${this.progress.days.length} practice day${this.progress.days.length === 1 ? '' : 's'} total, ` +
      `current streak ${streak}. Mastery = ½ coverage + ½ cards at a 21-day interval.`;
    panel.append(note);
    return [panel];
  }

  private renderSets(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const listPanel = el('div', 'panel');
    for (const set of this.sets()) {
      const row = el('div', 'set-row');
      const name = el('span', 'name');
      name.textContent = set.name;
      const meta = el('span', 'meta');
      const custom = !bundledSets.some((b) => b.id === set.id);
      meta.textContent = `${set.tool} · ${set.shortcuts.length} shortcuts${custom ? ' · custom' : ''}`;
      row.append(name, meta);
      const spacer = el('span', 'spacer');
      row.append(spacer);
      if (set.id === this.progress.settings.setId) {
        const b = el('span', 'badge active');
        b.textContent = 'active';
        row.append(b);
      } else {
        const btn = el('button', 'btn') as HTMLButtonElement;
        btn.textContent = 'Practice this';
        btn.addEventListener('click', () => {
          this.progress.settings.setId = set.id;
          this.session = null;
          this.save();
          this.tab = 'practice';
          this.render();
        });
        row.append(btn);
      }
      if (custom) {
        const del = el('button', 'btn') as HTMLButtonElement;
        del.textContent = 'Delete';
        del.addEventListener('click', () => {
          this.progress.customSets = this.progress.customSets.filter((c) => c.id !== set.id);
          delete this.progress.cards[set.id];
          if (this.progress.settings.setId === set.id) this.progress.settings.setId = 'vscode';
          this.session = null;
          this.save();
          this.render();
        });
        row.append(del);
      }
      listPanel.append(row);
    }
    out.push(listPanel);

    const settingsPanel = el('div', 'panel');
    const row1 = el('div', 'settings-row');
    const label = document.createElement('label');
    label.textContent = 'New cards per session: ';
    const num = document.createElement('input');
    num.id = 'new-per-day';
    label.htmlFor = num.id;
    num.type = 'number';
    num.min = '1';
    num.max = '50';
    num.value = String(this.progress.settings.newPerDay);
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (Number.isInteger(v) && v >= 1 && v <= 50) {
        this.progress.settings.newPerDay = v;
        this.session = null;
        this.save();
      }
    });
    row1.append(label, num);
    const row2 = el('div', 'settings-row');
    const macLabel = document.createElement('label');
    const macBox = document.createElement('input');
    macBox.type = 'checkbox';
    macBox.checked = this.progress.settings.macMode;
    macBox.addEventListener('change', () => {
      this.progress.settings.macMode = macBox.checked;
      this.session = null;
      this.save();
      this.render();
    });
    macLabel.append(macBox, ' macOS mode (expect ⌘ where Windows/Linux uses Ctrl)');
    row2.append(macLabel);
    settingsPanel.append(row1, row2);
    out.push(settingsPanel);

    const uploadPanel = el('div', 'panel');
    const uh = document.createElement('h3');
    uh.textContent = 'Add a custom set';
    uh.style.marginTop = '0';
    const ta = document.createElement('textarea');
    ta.className = 'upload';
    ta.placeholder = 'Paste a shortcut-set JSON here…';
    const urow = el('div', 'settings-row');
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.setAttribute('aria-label', 'Load a set from a JSON file');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    });
    const add = el('button', 'btn primary') as HTMLButtonElement;
    add.textContent = 'Validate & add';
    add.addEventListener('click', () => this.addCustomSet(ta.value));
    urow.append(file, add);
    uploadPanel.append(uh, ta, urow);
    if (this.uploadMessages) {
      if (this.uploadMessages.errors.length > 0) {
        uploadPanel.append(msgList(this.uploadMessages.errors, 'errors'));
      }
      if (this.uploadMessages.warnings.length > 0) {
        uploadPanel.append(msgList(this.uploadMessages.warnings, 'warnings'));
      }
    }
    const details = document.createElement('details');
    details.className = 'schema';
    const summary = document.createElement('summary');
    summary.textContent = 'JSON format';
    const pre = document.createElement('pre');
    pre.textContent = SAMPLE_SET;
    details.append(summary, pre);
    const note = el('p', 'note');
    note.textContent =
      'Combos: chords separated by spaces, keys joined with "+", e.g. "Ctrl+K Ctrl+S". ' +
      'Browser-reserved combos (Ctrl+W, Ctrl+T, Ctrl+N, Cmd equivalents) are dropped: a web page cannot capture them.';
    uploadPanel.append(details, note);
    out.push(uploadPanel);
    return out;
  }

  private addCustomSet(text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      this.uploadMessages = { errors: [`not valid JSON: ${(e as Error).message}`], warnings: [] };
      this.render();
      return;
    }
    const result = validateSet(raw);
    if (!result.ok) {
      this.uploadMessages = { errors: result.errors, warnings: [] };
      this.render();
      return;
    }
    if (bundledSets.some((b) => b.id === result.set.id)) {
      this.uploadMessages = { errors: [`id "${result.set.id}" is taken by a bundled set`], warnings: [] };
      this.render();
      return;
    }
    this.progress.customSets = this.progress.customSets.filter((c) => c.id !== result.set.id);
    this.progress.customSets.push(result.set);
    this.progress.settings.setId = result.set.id;
    this.session = null;
    this.save();
    this.uploadMessages = {
      errors: [],
      warnings: [`added "${result.set.name}" (${result.set.shortcuts.length} shortcuts)`, ...result.warnings],
    };
    this.render();
  }
}

// ---------- small DOM helpers ----------

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function metaItem(label: string, value: string): HTMLElement {
  const span = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = value;
  span.append(`${label}: `, b);
  return span;
}

function appendCells(tr: HTMLTableRowElement, values: string[]): void {
  for (const v of values) {
    const td = document.createElement('td');
    td.textContent = v;
    tr.append(td);
  }
}

function msgList(items: string[], kind: 'errors' | 'warnings'): HTMLElement {
  const ul = el('ul', `msg-list ${kind}`);
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  return ul;
}

function radarSvg(stats: SetStats[]): string {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const r = 110;
  const n = stats.length;
  const rings = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const pts = radarPoints(Array(n).fill(f), cx, cy, r);
      return `<polygon class="radar-grid" points="${pts}" fill="none" stroke-width="1"/>`;
    })
    .join('');
  const axes = radarAxes(n, cx, cy, r)
    .map((a) => `<line x1="${cx}" y1="${cy}" x2="${a.x.toFixed(1)}" y2="${a.y.toFixed(1)}" class="radar-grid"/>`)
    .join('');
  const labels = radarAxes(n, cx, cy, r + 22)
    .map((a, i) => {
      const anchor = Math.abs(a.x - cx) < 1 ? 'middle' : a.x > cx ? 'start' : 'end';
      return `<text x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" class="radar-label" font-size="12" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(stats[i].tool)}</text>`;
    })
    .join('');
  const shape = radarPoints(
    stats.map((s) => s.mastery),
    cx,
    cy,
    r,
  );
  // Side margins so labels anchored left or right of an axis are not clipped.
  const pad = 60;
  return (
    `<svg viewBox="${-pad} 0 ${size + 2 * pad} ${size}" width="${size + 2 * pad}" height="${size}" role="img" aria-label="Mastery per tool">` +
    `${rings}${axes}` +
    `<polygon class="radar-shape" points="${shape}" stroke-width="2"/>` +
    `${labels}</svg>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
