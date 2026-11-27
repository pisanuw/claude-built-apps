// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mountApp } from '../src/ui/app';

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
    const print = [...css.matchAll(/@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(24);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field borders and the focus ring, in both themes', () => {
    const text: [string, string][] = [
      ['--fg', '--bg'],
      ['--fg', '--card'],
      ['--fg', '--code-bg'],
      ['--muted', '--bg'],
      ['--muted', '--card'],
      ['--accent', '--bg'],
      ['--accent', '--card'],
      ['--accent-fg', '--accent'],
      ['--good', '--card'],
      ['--bad', '--card'],
      // The replay's running counts are the kind colours as text on the card ...
      ['--k-hit', '--card'],
      ['--k-compulsory', '--card'],
      ['--k-capacity', '--card'],
      ['--k-conflict', '--card'],
      // ... and its chips are --on-kind on them (white on --k-hit was 4.24:1, on --k-capacity 3.46:1, in light).
      ['--on-kind', '--k-hit'],
      ['--on-kind', '--k-compulsory'],
      ['--on-kind', '--k-capacity'],
      ['--on-kind', '--k-conflict'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11); --border was 1.28 to 1.51:1.
      for (const bg of ['--card', '--bg', '--code-bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring (the accent) on what it surrounds.
      for (const bg of ['--card', '--bg', '--code-bg']) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
      // The arrays' colours, in the swatches and the memory map, 3:1 on the card (graphics, WCAG 1.4.11),
      // and the cache grid's labels, which the canvas draws in --fg on a block of the colour at 55% over the card.
      const alpha = Number(readFileSync('src/ui/app.ts', 'utf8').match(/ctx\.globalAlpha = (0\.\d+);/)![1]);
      for (const k of ['--arr-0', '--arr-1', '--arr-2', '--arr-3', '--arr-4', '--arr-5']) {
        expect(ratio(rgb(t[k]), rgb(t['--card'])), `${theme}: ${k} on the card`).toBeGreaterThanOrEqual(3);
        expect(ratio(rgb(t['--fg']), mix(rgb(t[k]), rgb(t['--card']), alpha)), `${theme}: a label on ${k}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      // The header sits on the page: --fg on --bg.
      const [ink, bg] = [rgb(t['--fg']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    const ALLOWED: [string, string][] = [];
    const rest = css
      .replace(/@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(/@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g, '')
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
});

// Every rule whose selector matches the element, media queries included.
const rulesFor = (el: Element): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, s]) =>
      s.split(',').some((x) => {
        try {
          return el.matches(x.trim());
        } catch {
          return false; // selectors jsdom does not take
        }
      }),
    )
    .map((m) => m[2])
    .join(';');
const rules = (selector: string): string =>
  [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');

const FIELDS =
  'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])';

// The stylesheet's rules that give an element a border colour.
const BORDERS = [...css.replace(/@[a-z-]+[^;{}]*;/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
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
function expectFieldToken(fields: Element[]): void {
  for (const field of fields) {
    const own = BORDERS.filter((b) => matches(field, b.selector));
    expect(own.length, field.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML.slice(0, 120)}`).toContain('var(--field-border)');
  }
}

// A box that scrolls sideways must be reachable by keyboard (axe: scrollable-region-focusable):
// either it holds something focusable, or it is a focusable region with a name.
function expectReachable(boxes: Element[]): void {
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    const focusable = box.querySelector('[tabindex="0"], a[href], button, input, select, textarea, summary');
    if (focusable) continue;
    expect(box.getAttribute('tabindex'), box.outerHTML.slice(0, 80)).toBe('0');
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-label')).toBeTruthy();
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

// jsdom has no canvas: a 2D context that only counts what is drawn.
const drawn = { calls: 0 };
const fakeContext = new Proxy({} as Record<string, unknown>, {
  get: (_t, key) => (key === 'measureText' ? () => ({ width: 6 }) : () => void drawn.calls++),
  set: () => true,
});
HTMLCanvasElement.prototype.getContext = (() => fakeContext) as unknown as HTMLCanvasElement['getContext'];

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
  const press = (label: string): void => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!.click();
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the header beside the title and says what it will do', () => {
    expectInTitleRow(root);
    expect(root.querySelector('header .lede')).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row, which is one line at every width', () => {
    const row = root.querySelector('hw-theme-toggle')!.parentElement!;
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)|(^|[\s;])(max-)?width\s*:/);
    expect(rulesFor(row.parentElement!)).not.toMatch(/display:\s*(inline-)?(flex|grid)/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
    expect(rulesFor(row.querySelector('h1')!)).toMatch(/min-width:\s*0/);
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

  it('draws the theater again when the theme changes, so the canvases take the new colours', () => {
    press('Next miss');
    const before = drawn.calls;
    button().click();
    expect(drawn.calls).toBeGreaterThan(before);
    const mid = drawn.calls;
    // The device setting changing, with nothing stored, fires the same event.
    document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'light' } }));
    expect(drawn.calls).toBeGreaterThan(mid);
  });

  it('gives every text field its border from --field-border (back on --border fails)', () => {
    const compare = root.querySelector<HTMLInputElement>('#compare')!;
    if (!compare.checked) compare.click();
    press('Generate');
    const fields = [...root.querySelectorAll(FIELDS)];
    const kinds = new Set(fields.map((f) => f.tagName + (f.getAttribute('type') ?? '')));
    expect(kinds).toEqual(new Set(['SELECT', 'TEXTAREA', 'INPUTnumber', 'INPUTtext']));
    expectFieldToken(fields);
  });

  it('makes every box that scrolls sideways a focusable, named region: the results, the sweep and the quiz', async () => {
    const compare = root.querySelector<HTMLInputElement>('#compare')!;
    if (!compare.checked) compare.click();
    press('Run sweep');
    await new Promise((r) => setTimeout(r, 0));
    press('Generate');
    const boxes = [...root.querySelectorAll('.scroll')];
    expectReachable(boxes);
    const names = boxes.map((b) => b.getAttribute('aria-label')).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['Kernel A: by array', 'Kernel A: by source line', 'Kernel B: by array', 'Kernel B: by source line']));
  });

  it("lays the quiz and the kernels out in one column on a phone, not wider than the page (the quiz was 333 px at 320)", () => {
    expect(rules('.quiz')).toMatch(/minmax\(min\(300px, 100%\), 1fr\)/);
    expect(rules('.panes')).toMatch(/minmax\(min\(260px, 100%\), 1fr\)/);
  });

  it("gives the results' swatches the array's token, not its value now, so they flip with the theme", () => {
    const swatches = [...root.querySelectorAll<HTMLElement>('.swatch')];
    expect(swatches.length).toBeGreaterThan(1);
    for (const s of swatches) expect(s.getAttribute('style')).toMatch(/^background:var\(--arr-[0-5]\)$/);
  });

  it("colours the replay's chips with --on-kind, not white", () => {
    expect(rules('.chip.k-hit')).toMatch(/color:\s*var\(--on-kind\)/);
  });
});
