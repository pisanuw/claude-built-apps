// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { index, memoryStore } from './helpers';
import { mount, showMessage } from '../src/ui/app';

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

  it('main.ts loads hw-theme.js before it draws anything', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeGreaterThan(-1);
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf('showMessage('));
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
    expect(Object.keys(light)).toHaveLength(16);
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
      // The DDP stamp beside the title.
      ['--stamp', '--bg'],
      ['--stamp', '--panel'],
      ['--bad', '--bg'],
      ['--bad', '--panel'],
      ['--bad', '--bad-bg'],
      ['--warn', '--panel'],
      ['--warn', '--warn-bg'],
      ['--good', '--bg'],
      ['--good', '--panel'],
      ['--good', '--good-bg'],
      // The product editor's preview box.
      ['--ink', '--accent-soft'],
      ['--muted', '--accent-soft'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11); --line was 1.36 to 1.71:1.
      for (const bg of ['--panel', '--bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring (the accent) on what it surrounds.
      for (const bg of ['--panel', '--bg']) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      // The header sits on the page: --ink on --bg.
      const [ink, bg] = [rgb(t['--ink']), rgb(t['--bg'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("writes no colour outside the token blocks, except print's black on white", () => {
    const ALLOWED: [string, string][] = [
      ['body', '#fff'],
      ['body', '#000'],
    ];
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

const TABS = ['Your products', 'US price sheet', 'What changed', 'Postage and settings', 'How it works'];

describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
  });
  const start = () => mount(root, { index, history: [], store: memoryStore(), today: '2026-11-08' });
  const click = (label: string): void => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!.click();
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the header beside the title and says what it will do', () => {
    start();
    expectInTitleRow(root);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row, which is one line at every width', () => {
    start();
    const row = root.querySelector('hw-theme-toggle')!.parentElement!;
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)|(^|[\s;])(max-)?width\s*:/);
    // The header is a block, so the row takes the whole line; in a wrapping flex header it would need flex-basis 100%.
    const parent = rulesFor(row.parentElement!);
    expect(parent).not.toMatch(/display:\s*(inline-)?(flex|grid)/);
    expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
    const h1 = rulesFor(row.querySelector('h1')!);
    expect(h1).toMatch(/min-width:\s*0/);
    // The DDP stamp (::after) wraps whole beside a long title: the title is a wrapping flex row.
    expect(h1).toMatch(/display:\s*flex/);
    expect(h1).toMatch(/flex-wrap:\s*wrap/);
  });

  it('switches the page at once and remembers the choice', () => {
    start();
    button().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Switch to light mode');
    button().click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
  });

  it('stays in the header on every tab, before and after the sample shop', () => {
    start();
    for (const tab of TABS) {
      click(tab);
      expectInTitleRow(root);
    }
    click('Your products');
    click('Try a sample shop');
    for (const tab of TABS) {
      click(tab);
      expect(root.querySelector('main')!.children.length, tab).toBeGreaterThan(0);
      expectInTitleRow(root);
    }
  });

  it('is in the header while the tariff data loads, and when it cannot load', () => {
    showMessage(root, 'Loading the US tariff data…');
    expectInTitleRow(root);
    expect(root.querySelector('[role="status"]')!.textContent).toBe('Loading the US tariff data…');
    showMessage(root, 'The US tariff data could not be loaded.');
    expectInTitleRow(root);
  });

  it('main.ts shows the header with the switch while it loads, then the app', async () => {
    vi.resetModules();
    await import('../src/main');
    expectInTitleRow(root);
    expect(root.textContent).toContain('Loading the US tariff data');
    await vi.waitFor(() => expect(root.querySelector('nav')).not.toBeNull(), { timeout: 10_000 });
    expectInTitleRow(root);
  });

  it('makes every table that scrolls sideways on a phone reachable by keyboard, on every tab and in the import', () => {
    start();
    click('Try a sample shop');
    const boxes: Element[] = [];
    const named: string[] = [];
    const collect = (): void => {
      for (const box of root.querySelectorAll('.tablewrap')) {
        boxes.push(box);
        if (box.getAttribute('aria-label')) named.push(box.getAttribute('aria-label')!);
      }
    };
    for (const tab of TABS) {
      click(tab);
      collect();
    }
    // A saved sheet, then a changed price: the "Products to update" table.
    click('What changed');
    click('My shop shows the current sheet: save it');
    click('Your products');
    click('Edit');
    const price = [...root.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'UK selling price (£)')!;
    const input = document.getElementById(price.htmlFor) as HTMLInputElement;
    input.value = '40';
    input.dispatchEvent(new Event('change'));
    click('What changed');
    collect();
    // The import's preview table.
    click('Your products');
    click('Import a product CSV');
    const paste = root.querySelector('textarea') as HTMLTextAreaElement;
    paste.value = 'Title,Price,Weight (g)\nJug,24,500';
    click('Read pasted text');
    collect();
    expectReachable(boxes);
    expect(new Set(named)).toEqual(
      new Set(['US postage with duty included', 'Products to update', 'The UK duty layer over time', 'The first products to add']),
    );
    // A column's hidden heading is absolutely placed: the box must hold it, or it widens the page.
    expect(rules('.tablewrap')).toMatch(/position:\s*relative/);
  });

  it('gives every text field on every tab its border from --field-border (back on --line fails)', () => {
    start();
    click('Try a sample shop');
    const fields: Element[] = [];
    for (const tab of TABS) {
      click(tab);
      fields.push(...root.querySelectorAll(FIELDS));
    }
    click('Your products');
    click('Edit');
    fields.push(...root.querySelectorAll(FIELDS));
    expect(new Set(fields.map((f) => f.tagName + (f.getAttribute('type') ?? ''))).size).toBeGreaterThanOrEqual(4);
    expectFieldToken(fields);
  });
});
