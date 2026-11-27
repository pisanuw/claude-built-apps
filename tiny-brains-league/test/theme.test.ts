// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUSE_BOTS, brainBot } from '../src/core/bots';
import { runLadder } from '../src/core/ladder';
import { compileBrain, type BrainFile } from '../src/core/net';
import { newBoard, play } from '../src/core/connect4';
import { boardSvg } from '../src/ui/board';
import { mountApp } from '../src/ui/app';
import { state } from '../src/ui/state';

// The matches run in a Web Worker, which jsdom does not have: play a short ladder here instead.
class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  postMessage(req: { type: string; house?: string[]; brains?: { id: string; file: BrainFile }[] }): void {
    if (req.type !== 'ladder') return;
    const bots = [...HOUSE_BOTS.filter((b) => req.house!.includes(b.id)), ...req.brains!.map((b) => brainBot(b.id, b.file.name, compileBrain(b.file)))];
    const result = runLadder(bots, { openings: 1 });
    queueMicrotask(() => this.onmessage?.({ data: { type: 'ladder', result } }));
  }
  terminate(): void {}
}
vi.stubGlobal('Worker', FakeWorker);

const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the copies of the shared switch', () => {
  it('hw-theme.js is the platform copy, unchanged', () => {
    expect(sha(readFileSync('src/lib/hw-theme.js'), 'hex')).toBe(HW_THEME_SHA256);
  });

  it('the head snippet is unchanged and runs before any stylesheet', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const m = head.match(/<script>([^<]*hw-theme[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(`'sha256-${sha(m![1], 'base64')}'`).toBe(THEME_INIT_CSP);
    const stylesheet = head.search(/<link[^>]+stylesheet|<style/);
    expect(stylesheet === -1 || head.indexOf(m![0]) < stylesheet).toBe(true);
  });

  it('main.ts loads hw-theme.js before the app draws its header', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeGreaterThan(-1);
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf('mountApp('));
  });
});

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]): number => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: number[], b: number[], share: number): number[] => a.map((v, i) => share * v + (1 - share) * b[i]);

describe('the palette', () => {
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

  it('is the same for the switch and for the device setting', () => {
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });

  it('keeps both dark blocks to the screen, so paper gets the light set', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    const screenAttr = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/;
    const screenDevice = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/;
    expect(css).toMatch(screenAttr);
    expect(css).toMatch(screenDevice);
    // No other rule follows the theme or the device setting, which print would then follow too.
    expect(css.replace(screenAttr, '').replace(screenDevice, '')).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(/@media print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[}\s])hw-theme-toggle\s*\{[^}]*display:\s*none\s*!important/);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(20);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field borders and the focus ring, in both themes', () => {
    const text: [string, string][] = [
      ['--ink', '--bg'],
      ['--ink', '--panel'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent-ink', '--accent'],
      ['--good', '--panel'],
      // The milestone badges (the light --good was 4.45:1 on --good-bg).
      ['--good', '--good-bg'],
      ['--bad', '--panel'],
      ['--bad', '--bad-bg'],
      ['--warn', '--panel'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11); --line was 1.27 to 1.52:1.
      for (const bg of ['--panel', '--bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring (the accent) on what it surrounds.
      for (const bg of ['--panel', '--bg']) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
      // The head-to-head scores sit on up to 35% of --good over the panel (the dark accent was 2.86:1 there).
      const cell = mix(rgb(t['--good']), rgb(t['--panel']), 0.35);
      for (const fg of ['--ink', '--cell-link']) expect(ratio(rgb(t[fg]), cell), `${theme}: ${fg} on the strongest cell`).toBeGreaterThanOrEqual(4.5);
      // The replay's winning and must-block dots sit in an empty hole, not on the board's blue
      // (the discs and the holes are the game's own look; white dots were 1.08:1 on the light hole).
      expect(ratio(rgb(t['--mark']), rgb(t['--hole'])), `${theme}: the dots on an empty hole`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, dark]) {
      // The header sits on the page: --ink on --bg.
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    const ALLOWED: [string, string][] = [];
    const rest = css
      .replace(/@media screen and \(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(/@media screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g, '')
      .replace(/:root\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found: string[] = [];
    for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) {
        for (const selector of selectors.split(',').map((x) => x.trim())) {
          if (!ALLOWED.some(([s, c]) => s === selector && c === colour.toLowerCase())) found.push(`${selector}: ${colour}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("draws the replay's dots in --mark, inside a column's next empty hole", () => {
    expect(rules('.mark')).toMatch(/stroke:\s*var\(--mark\)/);
    expect(rules('.disc.empty')).toMatch(/fill:\s*var\(--hole\)/);
    const b = newBoard();
    play(b, 3);
    const svg = boardSvg(b, { marks: [3, 6] });
    const holes = [...svg.querySelectorAll('circle.disc.empty')].map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`);
    const dots = [...svg.querySelectorAll('circle.mark')];
    expect(dots).toHaveLength(2);
    for (const d of dots) expect(holes).toContain(`${d.getAttribute('cx')},${d.getAttribute('cy')}`);
  });

  it("colours the head-to-head scores with --cell-link", () => {
    expect(rules('.matrix td.cell button.link')).toMatch(/color:\s*var\(--cell-link\)/);
    expect(rules('.matrix td.cell')).toMatch(/calc\(var\(--frac\) \* 35%\)/);
  });

});

// Every rule for a selector, media queries included.
const rules = (selector: string): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
// Every rule whose selector matches the element, media queries included.
const rulesFor = (el: Element): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, s]) =>
      s.split(',').some((x) => {
        try {
          return el.matches(x.trim());
        } catch {
          return false; // keyframe stops and selectors jsdom does not take
        }
      }),
    )
    .map((m) => m[2])
    .join(';');

// A box that scrolls sideways must be reachable by keyboard (axe: scrollable-region-focusable):
// either it holds something focusable, or it is a focusable region with a name.
function expectReachable(boxes: Element[]): void {
  for (const box of boxes) {
    const focusable = box.querySelector('[tabindex="0"], a[href], button, input, select, textarea, summary');
    if (focusable) continue;
    expect(box.getAttribute('tabindex'), box.outerHTML.slice(0, 80)).toBe('0');
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-label')).toBeTruthy();
  }
}

const FIELDS =
  'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])';

function expectFieldToken(fields: Element[]): void {
  // The stylesheet's rules that give an element a border colour.
  const borders = [...css.replace(/@[a-z-]+[^;{}]*;/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
    [...body.matchAll(/(?:^|;)\s*border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?\s*:([^;]+)/g)].map((d) => ({
      selector: selector.trim(),
      value: d[1].trim(),
    })),
  );
  const matches = (el: Element, selector: string): boolean => {
    try {
      return el.matches(selector);
    } catch {
      return false; // ::placeholder and other selectors jsdom does not take
    }
  };
  for (const field of fields) {
    const own = borders.filter((b) => matches(field, b.selector));
    expect(own.length, field.outerHTML).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML}`).toContain('var(--field-border)');
  }
}

/** The switch is the last thing in a one-line title row, beside the h1, inside a header. */
function expectInTitleRow(root: ParentNode): void {
  const toggles = root.querySelectorAll('hw-theme-toggle');
  expect(toggles).toHaveLength(1);
  const row = toggles[0].parentElement!;
  expect(row.classList.contains('title-row')).toBe(true);
  expect(row.lastElementChild).toBe(toggles[0]);
  expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
  expect(row.closest('header')).not.toBeNull();
}

const TABS = ['train', 'brains', 'ladder', 'replay', 'guide'];

describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    mountApp(root);
  });
  const show = (tab: string): void => root.querySelector<HTMLButtonElement>(`#tab-${tab}`)!.click();
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the header beside the title and says what it will do', () => {
    expectInTitleRow(root);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row, which is one line at every width', () => {
    expectInTitleRow(root);
    const row = root.querySelector('hw-theme-toggle')!.parentElement!;
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)/);
    // In a header that is itself a wrapping flex row, the title row must take the whole line,
    // or the switch ends up in the middle of the header.
    const parent = rulesFor(row.parentElement!);
    if (/display:\s*flex/.test(parent) && /flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b/.test(parent)) expect(own).toMatch(/flex(?:-basis)?:\s*(?:1 1 )?100%/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
  });

  it('switches the page at once and remembers the choice', () => {
    button().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Switch to light mode');
    button().click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
  });

  it('stays in the header on every tab', () => {
    for (const tab of TABS) {
      show(tab);
      expect(root.querySelector('main')!.children.length, tab).toBeGreaterThan(0);
      expectInTitleRow(root);
    }
  });

  it('gives every text field on every tab its border from --field-border (back on another colour fails)', () => {
    const fields: Element[] = [];
    for (const tab of TABS) {
      show(tab);
      fields.push(...root.querySelectorAll(FIELDS));
    }
    expect(new Set(fields).size).toBeGreaterThan(4);
    expectFieldToken(fields);
  });

  it("makes the guide's code blocks, which scroll sideways on a phone, focusable, labelled regions", () => {
    show('guide');
    const blocks = [...root.querySelectorAll('pre')];
    expect(blocks).toHaveLength(2);
    expectReachable(blocks);
    expect(blocks.map((b) => b.getAttribute('aria-label'))).toEqual(['An example brain file', 'Checking a brain file']);
  });

  it('makes the training log a focusable, labelled region', () => {
    state.runs.push({ id: 'r1', name: 'tiny', hidden: '16', activation: 'relu', params: 1479, method: 'imitation', teacher: 'scripted', games: 200, epochs: 4, generations: 0, seed: 1, vsRandom: 0.9, vsScripted: 0.4, seconds: 3, at: '2026-11-27T00:00:00Z' });
    try {
      document.body.innerHTML = '<div id="app"></div>';
      root = document.getElementById('app') as HTMLElement;
      mountApp(root);
      const boxes = [...root.querySelectorAll('.table-wrap')];
      expect(boxes).toHaveLength(1);
      expectReachable(boxes);
      expect(boxes[0].getAttribute('aria-label')).toBe('Training runs');
    } finally {
      state.runs.pop();
    }
  });

  it("makes the ladder's rating tables focusable, labelled regions (the head-to-head table holds buttons)", async () => {
    show('ladder');
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Run ladder')!.click();
    await vi.waitFor(() => expect(root.querySelector('.matrix')).not.toBeNull(), { timeout: 20_000 });
    const boxes = [...root.querySelectorAll('#main .table-wrap')];
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expectReachable(boxes);
    expect(boxes.map((b) => b.getAttribute('aria-label')).filter(Boolean)[0]).toBe('Ratings');
  }, 30_000);
});
