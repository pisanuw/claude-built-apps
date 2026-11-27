// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWorkspace } from '../src/core/permalink';
import { mountApp } from '../src/ui/app';

// The page runs jobs in a Web Worker, which jsdom does not have: run them here instead.
vi.mock('../src/ui/runner', async () => {
  const { runJob } = await import('../src/core/jobs');
  return { TIMEOUT_MS: 30_000, run: async (req: Parameters<typeof runJob>[0]) => runJob(req), cancel: () => {} };
});

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
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6}|\d+%)/gi)].map((m) => [m[1], m[2]]));
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
    expect(Object.keys(light)).toHaveLength(22);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field borders, the focus ring and the bars, in both themes', () => {
    const text: [string, string][] = [
      ['--ink', '--bg'],
      ['--ink', '--panel'],
      ['--ink', '--code-bg'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--muted', '--code-bg'],
      ['--accent', '--panel'],
      ['--accent', '--code-bg'],
      ['--accent-ink', '--accent'],
      ['--bad', '--panel'],
      ['--good', '--good-bg'],
      ['--bad', '--bad-bg'],
      ['--warn', '--warn-bg'],
      ['--ink', '--good-bg'],
      ['--ink', '--bad-bg'],
      ['--ink', '--warn-bg'],
      // The outcome tables colour a row's error and ratio (#f97316 was 2.8:1 on the panel).
      ['--over-text', '--panel'],
      ['--under-text', '--panel'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11).
      for (const bg of ['--panel', '--bg', '--code-bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring (:focus-visible, the accent) and the histogram's bars on the panel.
      for (const fg of ['--accent', '--over', '--under', '--alien', '--muted', '--tick']) expect(ratio(rgb(t[fg]), rgb(t['--panel'])), `${theme}: ${fg} on the panel`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the heatmap's text at 4.5:1 on its strongest tint, in both themes", () => {
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      const share = parseFloat(t['--heat-max']) / 100;
      expect(share, theme).toBeGreaterThan(0.2);
      for (const tint of ['--over', '--under']) {
        const cell = mix(rgb(t[tint]), rgb(t['--panel']), share);
        expect(ratio(rgb(t['--ink']), cell), `${theme}: --ink on ${tint} at ${t['--heat-max']}`).toBeGreaterThanOrEqual(4.5);
      }
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

  it('colours the outcome tables\' text with the text tokens, not the bar colours', () => {
    const rule = (selector: string): string =>
      [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    expect(rule('.grid-table tr.over td:last-child')).toMatch(/color:\s*var\(--over-text\)/);
    expect(rule('.grid-table tr.under td:last-child')).toMatch(/color:\s*var\(--under-text\)/);
  });

  it("tints the heatmap's cells with --heat-max, not a fixed share", () => {
    const charts = readFileSync('src/ui/charts.ts', 'utf8');
    expect(charts).toMatch(/color-mix\(in srgb, var\(\$\{[^}]+\}\) calc\(\$\{[^}]+\} \* var\(--heat-max\)\), transparent\)/);
  });
});

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

describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(async () => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    mountApp(root);
    await vi.waitFor(() => expect(root.querySelector('.results .verdict')).not.toBeNull());
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;
  const click = (label: string): void => [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label))!.click();

  it('sits in the header beside the title and says what it will do', () => {
    const toggle = root.querySelector('header hw-theme-toggle')!;
    expect(toggle.previousElementSibling?.tagName).toBe('H1');
    expect(root.querySelectorAll('hw-theme-toggle')).toHaveLength(1);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row, which is one line at every width', () => {
    const toggle = root.querySelector('header hw-theme-toggle')!;
    const row = toggle.parentElement!;
    expect(row.classList.contains('title-row')).toBe(true);
    expect(row.lastElementChild).toBe(toggle);
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)/);
    // In a header that is itself a wrapping flex row, the title row must take the whole line,
    // or the switch ends up in the middle of the header.
    const parent = rulesFor(row.parentElement!);
    if (/display:\s*flex/.test(parent) && /flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b/.test(parent)) expect(own).toMatch(/flex(?:-basis)?:\s*(?:1 1 )?100%/);
    const reserve = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, sel]) => sel.trim() === 'hw-theme-toggle:not([hidden])').map((m) => m[2]).join(';');
    expect(reserve).toMatch(/flex:\s*none/);
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

  it('names the link field it shows when the clipboard refuses, or is missing, for both copy buttons', async () => {
    const linkField = (): HTMLInputElement | null => root.querySelector('input[readonly]');
    const expectNamed = (): void => {
      const field = linkField()!;
      expect(field).not.toBeNull();
      expect(field.getAttribute('aria-label')).toBe('Link to copy');
      expect(field.value).toMatch(/#w=/);
    };
    const nav = navigator as Navigator & { clipboard?: Clipboard };
    const had = Object.getOwnPropertyDescriptor(nav, 'clipboard');
    try {
      // No clipboard at all (jsdom, an http page): the field at once.
      Object.defineProperty(nav, 'clipboard', { value: undefined, configurable: true });
      click('Copy link');
      expectNamed();
      // A clipboard that refuses (a headless browser, a denied permission): the field after the refusal.
      Object.defineProperty(nav, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
      click('Copy link');
      await vi.waitFor(() => expect(linkField()).not.toBeNull());
      expectNamed();
      click('Create exercise link');
      await vi.waitFor(() => expect(root.querySelectorAll('input[readonly]')).toHaveLength(2));
      for (const field of root.querySelectorAll('input[readonly]')) expect(field.getAttribute('aria-label')).toBe('Link to copy');
      // A clipboard that works: a message, no field.
      Object.defineProperty(nav, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
      click('Copy link');
      await vi.waitFor(() => expect(root.textContent).toContain('Link to this code copied'));
      const done = [...root.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Link to this code copied'))!;
      expect(done.querySelector('input')).toBeNull();
    } finally {
      if (had) Object.defineProperty(nav, 'clipboard', had);
      else delete (nav as { clipboard?: Clipboard }).clipboard;
    }
  });

  it('gives every text field its border from --field-border (a field back on another colour fails)', () => {
    const fields = [...root.querySelectorAll(FIELDS)];
    expect(fields.length).toBeGreaterThan(5);
    expectFieldToken(fields);
  });

  it('makes the gallery chips toggle buttons in a named group (role="listitem" does not allow aria-pressed)', () => {
    const chips = [...root.querySelectorAll('.chips .chip')];
    expect(chips.length).toBeGreaterThan(3);
    expect(chips[0].parentElement!.getAttribute('role')).toBe('group');
    expect(chips[0].parentElement!.getAttribute('aria-label')).toBeTruthy();
    for (const chip of chips) {
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('role')).toBeNull();
      expect(['true', 'false']).toContain(chip.getAttribute('aria-pressed'));
    }
  });

  it('makes every table that scrolls sideways a focusable, labelled region: exact, the heatmap, and counted', async () => {
    const exact = [...root.querySelectorAll('.table-scroll')];
    expect(exact).toHaveLength(1);
    expectReachable(exact);
    click('Naive shuffle');
    await vi.waitFor(() => expect(root.querySelector('.heatmap')).not.toBeNull());
    const shuffle = [...root.querySelectorAll('.table-scroll')];
    expect(shuffle).toHaveLength(2);
    expectReachable(shuffle);
    click('Statistical test');
    await vi.waitFor(() => expect(root.querySelector('.facts dt')?.textContent).toBe('Draws'));
    const counted = [...root.querySelectorAll('.table-scroll')];
    expect(counted.length).toBeGreaterThanOrEqual(1);
    expectReachable(counted);
    expect(new Set([...exact, ...shuffle, ...counted].map((b) => b.getAttribute('aria-label')))).toEqual(
      new Set(['Every outcome, exact', 'Where each item ends up', 'Every outcome, counted']),
    );
  });
});

describe("the switch on a student's exercise page", () => {
  it('is at the end of the title row there too, and its fields use --field-border', () => {
    const w = {
      code: 'function sample(rng, n) {\n  return rng.next() % n;\n}',
      args: [6],
      target: { kind: 'uniform-int' as const, n: 6 },
      bits: 8,
      draws: 200_000,
      exercise: {
        title: 'Fair die',
        prompt: 'Make every face equally likely.',
        args: [6],
        target: { kind: 'uniform-int' as const, n: 6 },
        alpha: 0.01,
        bits: 8,
        draws: 200_000,
        allowBelow: false,
        starter: 'function sample(rng, n) {\n  return rng.next() % n;\n}',
      },
    };
    history.replaceState(null, '', `/#w=${encodeWorkspace(w)}`);
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    mountApp(root);
    expect(root.querySelector('.exercise h2')?.textContent).toBe('Fair die');
    const toggles = root.querySelectorAll('hw-theme-toggle');
    expect(toggles).toHaveLength(1);
    expect(toggles[0].parentElement!.classList.contains('title-row')).toBe(true);
    expect(toggles[0].parentElement!.lastElementChild).toBe(toggles[0]);
    expect(toggles[0].closest('header')).not.toBeNull();
    const fields = [...root.querySelectorAll(FIELDS)];
    expect(fields.length).toBeGreaterThan(3);
    expectFieldToken(fields);
    history.replaceState(null, '', '/');
  });
});
