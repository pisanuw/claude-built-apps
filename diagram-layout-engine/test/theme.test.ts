// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { start } from '../src/ui/app';
import { themeCss } from '../src/core/themes';
import { layoutChart } from '../src/core/layout';
import { parse } from '../src/core/parser';
import { renderSvg } from '../src/core/svg';
const sha = (s: string | Uint8Array, enc: 'hex' | 'base64'): string => createHash('sha256').update(s).digest(enc);

// Compared with the source in this repository, so a change to platform/src/theme
// fails here until the copy is updated (platform/test/theme-copies.test.ts checks
// every app's copy the same way).
const SOURCE = '../platform/src/theme/';
const HW_THEME_SHA256 = sha(readFileSync(`${SOURCE}hw-theme.js`), 'hex');
const THEME_INIT_CSP = `'sha256-${sha(readFileSync(`${SOURCE}theme-init.js`), 'base64')}'`;
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const main = readFileSync('src/main.ts', 'utf8');

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

  it('main.ts loads hw-theme.js first, before the stylesheet and before it draws the header', () => {
    const at = main.indexOf("import './lib/hw-theme.js';");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("import './ui/styles.css';"));
  });

  it('the stylesheet is linked in the head, not added by the script (no flash of the device theme)', () => {
    // The head check above passes when the head has no stylesheet; Vite links one that main.ts imports as a file.
    expect(main).toMatch(/^import '\.\/ui\/styles\.css';$/m);
    expect(main).not.toMatch(/\.css\?inline/);
    expect(main).not.toMatch(/createElement\(\s*['"]style['"]/);
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
const PRINT = /@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
const SCREEN_ATTR = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/g;
const SCREEN_DEVICE = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/g;

describe('the palette', () => {
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

  it('is the same for the switch and for the device setting', () => {
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });

  it('keeps both dark blocks to the screen, so paper gets the light set', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    expect(css).toMatch(new RegExp(SCREEN_ATTR.source));
    expect(css).toMatch(new RegExp(SCREEN_DEVICE.source));
    // No other rule follows the theme or the device setting, which print would then follow too.
    expect(css.replace(SCREEN_ATTR, '').replace(SCREEN_DEVICE, '')).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('leaves the switch off paper', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('sets every colour the light theme sets', () => {
    const names = (re: RegExp): string[] => [...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
    const darkNames = names(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    // Each dark token is one the light theme sets too; a colour the dark set leaves out keeps its light value on purpose.
    for (const n of darkNames) expect(names(/:root\s*\{([^}]*)\}/), n).toContain(n);
    expect(Object.keys(light)).toHaveLength(16);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text', '--surface'],
      ['--text', '--surface-2'],
      ['--text', '--code-bg'],
      ['--muted', '--bg'],
      ['--muted', '--surface'],
      ['--muted', '--surface-2'],
      ['--muted', '--code-bg'],
      ['--accent', '--surface'],
      ['--accent', '--bg'],
      ['--accent', '--accent-soft'],
      ['--accent-ink', '--accent'],
      ['--danger', '--surface'],
      ['--danger', '--danger-soft'],
      ['--ok', '--surface'],
      ['--ok', '--surface-2'],
      ['--warn', '--surface'],
      ['--warn', '--surface-2'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields' and buttons' edges, and the crossings chart's bars (WCAG 1.4.11): --border was 1.18 to 1.54:1.
      for (const bg of ["--surface", "--bg", "--surface-2", "--code-bg"]) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--text']), rgb(t['--surface'])];
      expect(ratio(mix(ink, bg, share), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    
    const ALLOWED: [string, string][] = [

    ];
    const rest = css.replace(SCREEN_DEVICE, '').replace(SCREEN_ATTR, '').replace(/:root\s*\{[^}]*\}/g, '');
    const COLOUR =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon)(?![\w-])/gi;
    const found: string[] = [];
    for (const [, selectors, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const colour of body.match(COLOUR) ?? []) {
        for (const selector of selectors.split(',').map((x) => x.trim().replace(/\s+/g, ' '))) {
          if (!ALLOWED.some(([s, col]) => s === selector && col === colour.toLowerCase())) found.push(`${selector}: ${colour}`);
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
/** Every text field takes its edge from --field-border (a rule with no edge, border: none, aside). */
function expectFieldToken(fields: Element[]): void {
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    const own = BORDERS.filter((b) => matches(field, b.selector) && !/^(none|0)\b/.test(b.value));
    expect(own.length, field.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML.slice(0, 120)}`).toContain('var(--field-border)');
  }
}

/** The switch is the last thing in a one-line title row, right after the h1, inside a header. */
function expectInTitleRow(root: ParentNode): void {
  const toggles = root.querySelectorAll('hw-theme-toggle');
  expect(toggles).toHaveLength(1);
  const row = toggles[0].parentElement!;
  expect(row.classList.contains('title-row')).toBe(true);
  expect(row.lastElementChild).toBe(toggles[0]);
  expect(toggles[0].previousElementSibling?.tagName).toBe('H1');
  expect(row.closest('header')).not.toBeNull();
  const own = rulesFor(row);
  expect(own).toMatch(/display:\s*flex/);
  expect(own).toMatch(/justify-content:\s*space-between/);
  expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b/);
  expect(rulesFor(row.querySelector('h1')!)).toMatch(/min-width:\s*0/);
  expect(rules('hw-theme-toggle:not([hidden])')).toMatch(/flex:\s*none/);
  // In a header that wraps (flex-wrap), the row takes a whole line, so the switch is never alone on one.
  const header = row.parentElement!;
  if (/flex-wrap:\s*wrap/.test(rulesFor(header))) expect(own).toMatch(/flex:\s*1 1 100%|flex-basis:\s*100%/);
}

/** A box that scrolls sideways is reachable by keyboard: a focusable region with a name (axe: scrollable-region-focusable). */
function expectRegion(box: Element | null, name: string): void {
  expect(box, name).not.toBeNull();
  expect(box!.getAttribute('tabindex')).toBe('0');
  expect(box!.getAttribute('role')).toBe('region');
  expect(box!.getAttribute('aria-label')).toBe(name);
}

describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    // jsdom has no canvas; without a context the app measures text by its length.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
    await import('../src/lib/hw-theme.js');
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    await start(root);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    root.querySelector<HTMLButtonElement>('#tab-editor')!.click();
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;
  const choose = (id: string, value: string): void => {
    const select = root.querySelector<HTMLSelectElement>(id)!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it("ends the title row, which takes the header's first line after the logo, and says what it will do", () => {
    expectInTitleRow(root);
    const row = root.querySelector('header.top > .title-row')!;
    expect(row.firstElementChild!.classList.contains('logo')).toBe(true);
    expect(root.querySelector('header.top > .title-row + .tagline')).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('switches the page at once and remembers the choice', () => {
    button().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hw-theme')).toBe('dark');
    expect(button().getAttribute('aria-label')).toBe('Switch to light mode');
    button().click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('hw-theme')).toBe('light');
    window.hintwise!.theme!.set(null);
  });

  it("gives a diagram on Auto the page's dark set when the switch says dark, on screen only", () => {
    const auto = themeCss('auto', '.dle');
    expect(auto).toContain('@media screen{:root[data-theme="dark"] .dle{');
    expect(auto).toContain('@media screen and (prefers-color-scheme: dark){:root:not([data-theme="light"]) .dle{');
    // The device setting alone, as it was, would keep a diagram dark after the switch chose light, and on paper.
    expect(auto).not.toMatch(/@media \(prefers-color-scheme/);
    expect(themeCss('light', '.dle')).not.toContain('@media');
  });

  it("lets an exported SVG on Auto follow its viewer's dark setting, as it did before the switch (batch 7 review R1-2)", () => {
    // The page's two rules need <html> above the SVG; a file opened on its own has the <svg> as its root.
    const chart = parse('flowchart TD\nA --> B');
    const file = renderSvg(layoutChart(chart), { theme: 'auto', idPrefix: 'dle', classDefs: chart.classDefs });
    const doc = new DOMParser().parseFromString(file, 'image/svg+xml');
    const svg = doc.documentElement;
    expect(svg.id).toBe('dlesvg');
    const style = svg.querySelector('style')!.textContent!;
    const device = style.match(/@media screen and \(prefers-color-scheme: dark\)\{((?:[^{}]*\{[^{}]*\})*)\}/)![1];
    const rules = [...device.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector, body }));
    const own = rules.find((r) => svg.matches(r.selector));
    expect(own, 'a dark rule that matches the root <svg> of a standalone file').toBeTruthy();
    // The dark set, the same as the page's.
    expect(own!.body).toBe(rules.find((r) => r.selector.startsWith(':root:not'))!.body);
    // In the page, the inline <svg> is never the root, so the switch alone decides there.
    expect(root.querySelector('#canvas svg')!.matches(own!.selector.replace('#dlesvg', '#edsvg'))).toBe(false);
  });

  it('draws a diagram on Auto again when the theme changes, and leaves one in a fixed theme alone', () => {
    const svg = (): Element => root.querySelector('#canvas svg')!;
    const first = svg();
    expect(first).not.toBeNull();
    // The device setting changing, with nothing stored, fires the same event as the switch.
    document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'dark' } }));
    expect(svg()).not.toBe(first);
    choose('#o-theme', 'light');
    const fixed = svg();
    document.dispatchEvent(new CustomEvent('hw-themechange', { detail: { theme: 'light' } }));
    expect(svg()).toBe(fixed);
    choose('#o-theme', 'auto');
  });

  it("exports a diagram on Auto in the page's mode, not the device's", () => {
    const app = readFileSync('src/ui/app.ts', 'utf8');
    expect(app).not.toMatch(/prefers-color-scheme/);
    expect(app).toMatch(/window\.hintwise\?\.theme\?\.get\(\)/);
  });

  it('gives the fields and the plain buttons their edge from --field-border', () => {
    // The source field sits borderless in .code, whose edge it takes; the segmented buttons share .seg's.
    const fields = [...root.querySelectorAll<HTMLElement>(FIELDS)].filter((f) => f.id !== 'source');
    expect(fields.length).toBeGreaterThanOrEqual(6);
    const buttons = [...root.querySelectorAll('button:not(.primary):not(.link):not(.tab)')].filter((b) => !b.closest('.seg'));
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    expectFieldToken([...fields, ...buttons]);
    for (const box of ['.code', '.seg']) expect(rules(box), box).toMatch(/border:\s*1px solid var\(--field-border\)/);
    // The crossings chart's bars, whose height is the count, are 3:1 on the stage too.
    expect(rules('.bar')).toMatch(/background:\s*var\(--field-border\)/);
  });

  it('names the 100% button by what it shows and does', () => {
    const z = root.querySelector('#z-100')!;
    expect(z.getAttribute('aria-label')).toContain(z.textContent!.trim());
  });

  it('lets the keyboard reach the boxes that scroll, and names the routed diagram', () => {
    root.querySelector<HTMLButtonElement>('#tab-pipeline')!.click();
    const stage = (id: string): void => root.querySelector<HTMLButtonElement>(`[data-stage="${id}"]`)!.click();
    stage('acyclic');
    expectRegion(root.querySelector('.sch-wrap'), 'Schematic');
    expect(root.querySelector('svg.sch')!.getAttribute('aria-label')).toMatch(/^Layout schematic/);
    stage('rank');
    const both = root.querySelectorAll('.compare .sch-wrap');
    expectRegion(both[0], 'Schematic: longest path');
    expectRegion(both[1], 'Schematic: the layering used');
    for (const id of ['normalize', 'order', 'position']) {
      stage(id);
      expectRegion(root.querySelector('.sch-wrap'), 'Schematic');
    }
    stage('route');
    expect(root.querySelector('#plsvg > title')!.textContent).toBe('The routed diagram');
    root.querySelector<HTMLButtonElement>('#tab-guide')!.click();
    const pre = [...root.querySelectorAll('.cheat pre')];
    expect(pre).toHaveLength(5);
    for (const p of pre) expectRegion(p, `${p.previousElementSibling!.textContent!.trim()} syntax`);
  });

  it('prints the filled buttons in the ink, underlines the current stage and keeps the bars', () => {
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    const within = (selector: string): string =>
      [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
    for (const s of ['button.primary', '.stage-tab.active']) expect(within(s), s).toMatch(/color:\s*var\(--text\)/);
    expect(within('.stage-tab.active')).toMatch(/text-decoration:\s*underline/);
    expect(within('.bar')).toMatch(/(?:^|;)\s*print-color-adjust:\s*exact/);
    expect(within('.bar')).toMatch(/-webkit-print-color-adjust:\s*exact/);
    const blocks = [...css.matchAll(PRINT)];
    expect(blocks).toHaveLength(1);
    expect(css.slice(blocks[0].index! + blocks[0][0].length).trim()).toBe('');
    // The gutter's line numbers were faded with opacity, to 2.52:1 in light.
    expect(rules('.gutter')).not.toMatch(/opacity/);
  });
});

