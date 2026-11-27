import { parseCsv, toCsv, validTableName } from '../core/csv';
import { DEMO_QUERIES, DEMO_TABLES } from '../core/datasets';
import { execute } from '../core/execute';
import { parse } from '../core/parse';
import { decodeShare, encodeShare } from '../core/share';
import { SqlError, type Step, type Table } from '../core/types';
import { escapeHtml, renderStep, renderTimeline } from './render';

const PLAY_INTERVAL_MS = 2600;

interface TablePane {
  name: string;
  csv: string;
}

export class App {
  private root: HTMLElement;
  private panes: TablePane[] = [];
  private activePane = 0;
  private steps: Step[] = [];
  private current = 0;
  private playing = false;
  private timer: number | null = null;
  private error: string | null = null;
  private shareNotice = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.loadInitial();
    this.renderShell();
    this.run();
  }

  private loadInitial(): void {
    if (location.hash.length > 1) {
      try {
        const ws = decodeShare(location.hash);
        this.panes = ws.tables.map((t) => ({ name: t.name, csv: toCsv(t) }));
        this.sqlText = ws.sql;
        return;
      } catch {
        // Fall through to the demo workspace on a bad link.
      }
    }
    this.panes = DEMO_TABLES.map((t) => ({ name: t.name, csv: t.csv }));
    this.sqlText = DEMO_QUERIES[1].sql;
  }

  private sqlText = '';

  /* ------------------------------- rendering ------------------------------- */

  private renderShell(): void {
    this.root.innerHTML = `
      <header>
        <div class="title-row"><h1>🎬 SQL Replay</h1><hw-theme-toggle></hw-theme-toggle></div>
        <p class="tagline">Type a SELECT, press Run, and watch it execute one stage at a time,
          narrated in plain English. Everything runs in your browser: no database, no server, no AI.</p>
      </header>
      <main>
        <section class="left">
          <label class="panel-label" for="sql">Query</label>
          <textarea id="sql" spellcheck="false" rows="8"></textarea>
          <div class="demos" id="demos"></div>
          <div class="actions">
            <button id="run" type="button" class="primary">▶ Run replay</button>
            <button id="share" type="button">🔗 Copy share link</button>
            <span id="share-notice" class="share-notice" hidden>link copied</span>
          </div>
          <label class="panel-label" for="csv">Sample data <span class="hint">(CSV, first line = column names)</span></label>
          <div class="tabs" id="tabs"></div>
          <textarea id="csv" spellcheck="false" rows="10"></textarea>
        </section>
        <section class="right" id="replay"></section>
      </main>
      <footer>
        <p>Deterministic single-pass teaching model: logical stage order
          (FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT),
          not a real planner. <a href="https://github.com/pisanuw/Claude-capstone/tree/main/sql-replay">Source on GitHub</a>.</p>
      </footer>`;
    this.sqlEl.value = this.sqlText;
    this.renderDemos();
    this.renderTabs();
    this.bind();
  }

  private get sqlEl(): HTMLTextAreaElement {
    return this.root.querySelector('#sql') as HTMLTextAreaElement;
  }

  private get csvEl(): HTMLTextAreaElement {
    return this.root.querySelector('#csv') as HTMLTextAreaElement;
  }

  private renderDemos(): void {
    const el = this.root.querySelector('#demos') as HTMLElement;
    el.innerHTML = DEMO_QUERIES.map(
      (q, i) =>
        `<button type="button" class="demo" data-demo="${i}" title="${escapeHtml(q.blurb)}">${escapeHtml(q.title)}</button>`,
    ).join('');
  }

  private renderTabs(): void {
    const el = this.root.querySelector('#tabs') as HTMLElement;
    el.innerHTML =
      this.panes
        .map(
          (p, i) =>
            `<button type="button" class="tab ${i === this.activePane ? 'active' : ''}" data-tab="${i}">${escapeHtml(p.name)}</button>`,
        )
        .join('') +
      `<button type="button" class="tab add" data-add-table title="Add a table">+</button>` +
      (this.panes.length > 1
        ? `<button type="button" class="tab remove" data-remove-table title="Remove current table">🗑</button>`
        : '');
    this.csvEl.value = this.panes[this.activePane]?.csv ?? '';
  }

  private renderReplay(): void {
    const el = this.root.querySelector('#replay') as HTMLElement;
    if (this.error) {
      el.innerHTML = `<div class="error"><strong>Cannot replay:</strong> ${escapeHtml(this.error)}</div>`;
      return;
    }
    if (this.steps.length === 0) {
      el.innerHTML = '<div class="placeholder">Press <strong>Run replay</strong> to start.</div>';
      return;
    }
    const step = this.steps[this.current];
    el.innerHTML = `
      <div class="timeline" id="timeline">${renderTimeline(this.steps, this.current)}</div>
      <div class="transport">
        <button type="button" id="first" title="Restart" ${this.current === 0 ? 'disabled' : ''}>⏮</button>
        <button type="button" id="prev" title="Previous stage" ${this.current === 0 ? 'disabled' : ''}>◀</button>
        <button type="button" id="play" class="primary" title="Autoplay">${this.playing ? '⏸ Pause' : '▶ Play'}</button>
        <button type="button" id="next" title="Next stage" ${this.current >= this.steps.length - 1 ? 'disabled' : ''}>▶</button>
        <span class="counter">stage ${this.current + 1} / ${this.steps.length}</span>
      </div>
      <div class="stage">${renderStep(step)}</div>`;
  }

  /* -------------------------------- behavior ------------------------------- */

  private bind(): void {
    this.root.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const demo = t.closest('[data-demo]') as HTMLElement | null;
      if (demo) {
        const q = DEMO_QUERIES[Number(demo.dataset.demo)];
        this.sqlEl.value = q.sql;
        if (!this.hasDemoTables()) {
          this.panes = DEMO_TABLES.map((d) => ({ name: d.name, csv: d.csv }));
          this.activePane = 0;
          this.renderTabs();
        }
        this.run();
        return;
      }
      const tab = t.closest('[data-tab]') as HTMLElement | null;
      if (tab) {
        this.saveActiveCsv();
        this.activePane = Number(tab.dataset.tab);
        this.renderTabs();
        return;
      }
      if (t.closest('[data-add-table]')) {
        this.saveActiveCsv();
        const name = prompt('Table name (letters, digits, underscores):', `table${this.panes.length + 1}`);
        if (!name) return;
        if (!validTableName(name)) { alert('Not a valid table name.'); return; }
        if (this.panes.some((p) => p.name.toLowerCase() === name.toLowerCase())) { alert('That table already exists.'); return; }
        this.panes.push({ name, csv: 'col1,col2\n' });
        this.activePane = this.panes.length - 1;
        this.renderTabs();
        return;
      }
      if (t.closest('[data-remove-table]')) {
        this.panes.splice(this.activePane, 1);
        this.activePane = Math.max(0, this.activePane - 1);
        this.renderTabs();
        return;
      }
      const chip = t.closest('[data-step]') as HTMLElement | null;
      if (chip) { this.pause(); this.goTo(Number(chip.dataset.step)); return; }
      if (t.closest('#run')) { this.run(); return; }
      if (t.closest('#share')) { void this.share(); return; }
      if (t.closest('#first')) { this.pause(); this.goTo(0); return; }
      if (t.closest('#prev')) { this.pause(); this.goTo(this.current - 1); return; }
      if (t.closest('#next')) { this.pause(); this.goTo(this.current + 1); return; }
      if (t.closest('#play')) {
        if (this.playing) this.pause();
        else this.play();
        return;
      }
    });
    this.root.addEventListener('keydown', (ev) => {
      // The element the key was pressed on: a key in a shadow root (the light and dark mode switch's button)
      // arrives retargeted to its host (platform/src/theme/README.md, "Key shortcuts").
      const t = (ev.composedPath()[0] ?? ev.target) as HTMLElement;
      if (t.tagName === 'TEXTAREA') {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.run(); }
        return;
      }
      // A scroll region (a result grid) keeps its keys, and Space presses a focused button or link.
      if (t.closest?.('[role="region"]')) return;
      if (ev.key === ' ' && t.closest?.('button, a, [role="button"]')) return;
      if (ev.key === 'ArrowRight') { this.pause(); this.goTo(this.current + 1); }
      if (ev.key === 'ArrowLeft') { this.pause(); this.goTo(this.current - 1); }
      if (ev.key === ' ') {
        ev.preventDefault();
        if (this.playing) this.pause();
        else this.play();
      }
    });
    this.csvEl.addEventListener('input', () => this.saveActiveCsv());
  }

  private hasDemoTables(): boolean {
    return DEMO_TABLES.every((d) => this.panes.some((p) => p.name === d.name));
  }

  private saveActiveCsv(): void {
    if (this.panes[this.activePane]) this.panes[this.activePane].csv = this.csvEl.value;
  }

  private buildTables(): Table[] {
    this.saveActiveCsv();
    return this.panes.map((p) => parseCsv(p.name, p.csv));
  }

  run(): void {
    this.pause();
    this.sqlText = this.sqlEl.value;
    try {
      const tables = this.buildTables();
      const query = parse(this.sqlText);
      this.steps = execute(query, tables);
      this.error = null;
      this.current = 0;
    } catch (e) {
      this.steps = [];
      this.error = e instanceof SqlError ? e.message : `Unexpected error: ${String(e)}`;
    }
    this.renderReplay();
    if (!this.error) this.play();
  }

  private goTo(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    this.current = i;
    this.renderReplay();
  }

  private play(): void {
    if (this.steps.length === 0) return;
    this.playing = true;
    this.timer = window.setInterval(() => {
      if (this.current >= this.steps.length - 1) { this.pause(); return; }
      this.current++;
      this.renderReplay();
    }, PLAY_INTERVAL_MS);
    this.renderReplay();
  }

  private pause(): void {
    this.playing = false;
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    this.renderReplay();
  }

  private async share(): Promise<void> {
    this.saveActiveCsv();
    try {
      const tables = this.buildTables();
      const hash = encodeShare({ sql: this.sqlEl.value, tables });
      const url = `${location.origin}${location.pathname}#${hash}`;
      history.replaceState(null, '', `#${hash}`);
      await navigator.clipboard.writeText(url);
      this.flashShareNotice();
    } catch (e) {
      this.error = e instanceof SqlError ? e.message : 'Could not build a share link';
      this.renderReplay();
    }
  }

  private flashShareNotice(): void {
    const el = this.root.querySelector('#share-notice') as HTMLElement | null;
    if (!el) return;
    el.hidden = false;
    this.shareNotice = true;
    window.setTimeout(() => {
      if (this.shareNotice) { el.hidden = true; this.shareNotice = false; }
    }, 2000);
  }
}
