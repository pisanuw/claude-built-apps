/**
 * The Popup Check panel that the bookmark opens on the owner's own store page.
 * It lives in a shadow root so the store's styles cannot reach it, and it is
 * ignored by every check.
 */
import { browserEnv, deepActiveElement, PANEL_HOST_ID, type Env } from '../engine/dom';
import { GuidedRecorder } from '../engine/guided';
import { encodeReport } from '../engine/report';
import { applyGuided, runEscapeTest, runTabTests, scanPage, toReport, type Scan, type ScanItem } from '../engine/scan';
import { hIn, type H } from '../ui/h';
import { countsLine, findingList, overlayHeading } from '../ui/render';
import { PANEL_CSS } from './panel-css';

export interface PanelOptions {
  /** Address of the Popup Check site, ending in '/'. */
  siteUrl: string;
  env?: Env;
  /** Opens the full report; defaults to window.open. */
  open?: (url: string) => void;
  /** Copies text; defaults to the clipboard. */
  copy?: (text: string) => Promise<void>;
  now?: () => Date;
  /** Run a check straight away (default true). */
  autoScan?: boolean;
}

type View = 'results' | 'guided' | 'busy';

export class Panel {
  readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly body: HTMLElement;
  private readonly h: H;
  private readonly env: Env;
  private scan: Scan | null = null;
  private view: View = 'results';
  private message = '';
  private recorder: GuidedRecorder | null = null;
  private recordingItem: ScanItem | null = null;
  private lastPageFocus: Element | null;
  private tracking = true;
  private highlight: HTMLElement | null = null;
  private readonly trackFocus = (e: Event): void => {
    if (!this.tracking) return;
    const t = (e.composedPath?.()[0] as Element | undefined) ?? null;
    if (t instanceof Element && !this.env.ignore(t)) this.lastPageFocus = t;
  };

  constructor(private readonly opts: PanelOptions) {
    this.env = opts.env ?? browserEnv();
    const doc = this.env.doc;
    this.lastPageFocus = deepActiveElement(doc);
    this.h = hIn(doc);
    this.host = doc.createElement('div');
    this.host.id = PANEL_HOST_ID;
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = PANEL_CSS;
    this.body = doc.createElement('section');
    this.body.setAttribute('aria-label', 'Popup Check');
    this.body.className = 'panel';
    this.shadow.append(style, this.body);
    (doc.body ?? doc.documentElement).append(this.host);
    doc.addEventListener('focusin', this.trackFocus, true);
    if (opts.autoScan !== false) void this.check();
    else this.render();
  }

  get root(): ShadowRoot {
    return this.shadow;
  }

  get current(): Scan | null {
    return this.scan;
  }

  close(): void {
    this.env.doc.removeEventListener('focusin', this.trackFocus, true);
    void this.recorder?.stop();
    this.clearHighlight();
    this.host.remove();
  }

  isOpen(): boolean {
    return this.host.isConnected;
  }

  /** Look at the page again. */
  async check(): Promise<void> {
    this.view = 'busy';
    this.render();
    const focused = this.lastPageFocus;
    this.tracking = false;
    try {
      this.scan = scanPage(this.env, focused, this.opts.now?.() ?? new Date());
      await runTabTests(this.env, this.scan);
    } finally {
      this.tracking = true;
    }
    this.message = '';
    this.view = 'results';
    this.render();
  }

  async testEscape(item: ScanItem): Promise<void> {
    this.tracking = false;
    try {
      await runEscapeTest(this.env, item);
    } finally {
      this.tracking = true;
    }
    this.message = `Escape test done for the ${overlayHeading(item.result).toLowerCase()}.`;
    this.render();
  }

  startGuided(item: ScanItem): void {
    this.recordingItem = item;
    this.recorder = new GuidedRecorder(this.env, item.overlay, () => this.updateRecording());
    this.view = 'guided';
    this.render();
    (deepActiveElement(this.env.doc) as HTMLElement | null)?.blur?.();
    this.recorder.start();
  }

  async finishGuided(): Promise<void> {
    if (!this.recorder || !this.recordingItem) return;
    const result = await this.recorder.stop();
    applyGuided(this.recordingItem, result);
    this.message = `Recorded ${result.tabs} Tab press${result.tabs === 1 ? '' : 'es'}${result.escapePressed ? ' and Escape' : ''}.`;
    this.recorder = null;
    this.recordingItem = null;
    this.view = 'results';
    this.render();
  }

  async openReport(): Promise<string> {
    if (!this.scan) return '';
    const code = await encodeReport(toReport(this.scan));
    const url = `${this.opts.siteUrl}#report=${code}`;
    (this.opts.open ?? ((u: string) => void window.open(u, '_blank')))(url);
    return url;
  }

  async copyCode(): Promise<void> {
    if (!this.scan) return;
    const code = await encodeReport(toReport(this.scan));
    const copy = this.opts.copy ?? ((t: string) => navigator.clipboard.writeText(t));
    try {
      await copy(code);
      this.message = 'Report code copied. Paste it on the Popup Check site under “Open a report”.';
    } catch {
      this.message = 'Could not copy automatically. Use “Open full report” instead.';
    }
    this.render();
  }

  showOnPage(item: ScanItem): void {
    this.clearHighlight();
    const b = this.env.rect(item.overlay.root);
    const mark = this.h('div', { class: 'highlight', style: `left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px` });
    this.shadow.append(mark);
    this.highlight = mark;
    void this.env.wait(2500).then(() => {
      if (this.highlight === mark) this.clearHighlight();
    });
  }

  private clearHighlight(): void {
    this.highlight?.remove();
    this.highlight = null;
  }

  private updateRecording(): void {
    const live = this.shadow.querySelector('[data-live]');
    const r = this.recorder?.current;
    if (!live || !r) return;
    const last = r.steps[r.steps.length - 1];
    live.textContent = `${r.tabs} Tab press${r.tabs === 1 ? '' : 'es'} so far.${last ? ` Focus is on ${last.label}${last.inside ? ', inside the popup' : ', outside the popup'}.` : ''}${r.escapePressed ? ' Escape pressed.' : ''}`;
  }

  private button(label: string, onClick: () => void, extra: Record<string, string> = {}): HTMLButtonElement {
    const b = this.h('button', { type: 'button', ...extra }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  render(): void {
    const h = this.h;
    const header = h(
      'div',
      { class: 'bar' },
      h('h2', { tabindex: '-1' }, 'Popup Check'),
      this.button('×', () => this.close(), { class: 'icon', 'aria-label': 'Close Popup Check' }),
    );
    const content: Node[] = [header];
    if (this.view === 'busy') {
      content.push(h('p', { role: 'status' }, 'Checking the page…'));
    } else if (this.view === 'guided' && this.recordingItem) {
      content.push(
        h('p', { class: 'lead' }, `Guided keyboard test: ${overlayHeading(this.recordingItem.result).toLowerCase()}`),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, 'Leave the mouse alone.'),
          h('li', {}, 'Press Tab slowly, about 10 times, and watch where the focus outline goes.'),
          h('li', {}, 'Then press Escape once.'),
          h('li', {}, 'Click Done.'),
        ),
        h('p', { 'data-live': '', role: 'status' }, 'Waiting for your first Tab press.'),
        this.button('Done', () => void this.finishGuided(), { class: 'primary', tabindex: '-1' }),
      );
    } else {
      const items = this.scan?.items ?? [];
      if (this.message) content.push(h('p', { role: 'status', class: 'message' }, this.message));
      if (!this.scan) {
        content.push(h('p', {}, 'Open the popup you want to test, then press Check now.'));
      } else if (!items.length) {
        content.push(
          h('p', { class: 'lead' }, 'No open popup found on this page.'),
          h('p', {}, 'Make your popup appear (wait for it, scroll down, or click what opens it), then press Check again. Popups that only appear once per visitor show again in a private window.'),
        );
      } else {
        content.push(h('p', { class: 'lead' }, `${items.length} open popup${items.length === 1 ? '' : 's'} found.`));
        for (const item of items) {
          const r = item.result;
          content.push(
            h(
              'article',
              { class: 'overlay' },
              h('h3', {}, overlayHeading(r)),
              h('p', { class: 'quote' }, `“${r.label}”`),
              h('p', { class: 'counts' }, countsLine(r)),
              h(
                'div',
                { class: 'actions' },
                this.button('Show it', () => this.showOnPage(item)),
                this.button('Guided keyboard test', () => this.startGuided(item)),
                r.kind !== 'chat' && r.kind !== 'age' ? this.button('Test Escape (may close it)', () => void this.testEscape(item)) : null,
              ),
              h('details', { open: items.length === 1 }, h('summary', {}, 'Results'), findingList(h, r, false)),
            ),
          );
        }
      }
      content.push(
        h(
          'div',
          { class: 'actions footer' },
          this.button(this.scan ? 'Check again' : 'Check now', () => void this.check()),
          this.scan && items.length ? this.button('Open full report', () => void this.openReport(), { class: 'primary' }) : null,
          this.scan && items.length ? this.button('Copy report code', () => void this.copyCode()) : null,
        ),
        h('p', { class: 'small' }, 'Test results only, not a compliance certificate. Nothing is sent anywhere until you open the report.'),
      );
    }
    this.body.replaceChildren(...content);
    // While recording, the panel must not take part in the Tab order.
    if (this.view === 'guided') this.body.querySelectorAll('button').forEach((b) => b.setAttribute('tabindex', '-1'));
  }
}

/** Open the panel, or close it if it is already open. */
export function togglePanel(opts: PanelOptions, existing?: Panel | null): Panel | null {
  if (existing?.isOpen()) {
    existing.close();
    return null;
  }
  return new Panel(opts);
}
