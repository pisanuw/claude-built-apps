// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeChallenge, generate } from '../src/core/challenge';
import { Analyzer } from '../src/ui/analyzer';
import { mountApp } from '../src/ui/app';

// The fault signatures are simulated in a Web Worker, which jsdom does not have: always ready, two faults alive.
vi.mock('../src/ui/signatures', () => ({
  SignatureService: class {
    diagnoser = { consistent: () => [0, 1], groups: () => [[0], [1]], bestProbe: () => null };
    ensure = () => Promise.resolve();
    ready = () => true;
    progress = () => 1;
    onProgress = () => {};
  },
}));

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
    expect(Object.keys(light)).toHaveLength(17);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field borders, in both themes', () => {
    const text: [string, string][] = [
      ['--fg', '--bg'],
      ['--fg', '--card'],
      ['--fg', '--code-bg'],
      ['--muted', '--bg'],
      ['--muted', '--card'],
      ['--muted', '--code-bg'],
      ['--accent', '--card'],
      ['--accent-fg', '--accent'],
      ['--good', '--card'],
      ['--bad', '--card'],
      ['--bad', '--code-bg'],
      ['--warn', '--card'],
      ['--pkg-fg', '--pkg'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11); --border was 1.27 to 1.53:1.
      for (const bg of ['--card', '--bg', '--code-bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The probed pins and nets, high and low, on the card.
      for (const fg of ['--hi', '--lo', '--accent', '--warn']) expect(ratio(rgb(t[fg]), rgb(t['--card'])), `${theme}: ${fg} on the card`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, dark]) {
      // The header sits on the page: --fg on --bg.
      const [ink, bg] = [rgb(t['--fg']), rgb(t['--bg'])];
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

const TABS = ['challenge', 'sandbox', 'instructor', 'about'];

describe('the switch in the header', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.clear();
    history.replaceState(null, '', `/#/challenge?c=${encodeChallenge(generate(1, 'board'))}`);
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    mountApp(root);
  });
  const go = (tab: string): void => {
    history.replaceState(null, '', `/#/${tab}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
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
    for (const tab of TABS.slice(1)) {
      go(tab);
      expect(root.querySelector('main')!.children.length, tab).toBeGreaterThan(0);
      expectInTitleRow(root);
    }
  });

  it('gives every text field on every tab its border from --field-border (back on another colour fails)', () => {
    const fields = [...root.querySelectorAll(FIELDS)];
    for (const tab of TABS.slice(1)) {
      go(tab);
      fields.push(...root.querySelectorAll(FIELDS));
    }
    expect(new Set(fields).size).toBeGreaterThan(6);
    expectFieldToken(fields);
  });

  it('names every select, text field and textarea on every tab (axe select-name and label, critical)', () => {
    const named = (f: Element): boolean => !!f.getAttribute('aria-label')?.trim() || !!f.closest('label') || !!(f.id && root.querySelector(`label[for="${f.id}"]`));
    const fields: Element[] = [...root.querySelectorAll('select, textarea, input')];
    // The challenge's own program, written by hand.
    const program = [...root.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'custom'))!;
    program.value = 'custom';
    program.dispatchEvent(new Event('change'));
    fields.push(...root.querySelectorAll('select, textarea, input'));
    for (const tab of TABS.slice(1)) {
      go(tab);
      fields.push(...root.querySelectorAll('select, textarea, input'));
    }
    expect(fields.filter((f) => f.tagName === 'TEXTAREA').length).toBeGreaterThanOrEqual(2);
    expect(fields.filter((f) => f.tagName === 'SELECT').length).toBeGreaterThan(6);
    for (const f of fields) expect(named(f), f.outerHTML.slice(0, 120)).toBe(true);
  });

  it("makes the logic analyzer's scroller and the fault lists reachable by keyboard, with names", () => {
    const analyzer = new Analyzer(() => {});
    const scroller = analyzer.root.querySelector('.la-scroll')!;
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(scroller.getAttribute('role')).toBe('region');
    expect(scroller.getAttribute('aria-label')).toBe('Captured waveforms');
    [...root.querySelectorAll<HTMLButtonElement>('.side button')].find((b) => b.textContent === 'Run')!.click();
    const lists = [...root.querySelectorAll('ul.faults')];
    expect(lists.length).toBeGreaterThan(0);
    for (const ul of lists) {
      expect(ul.getAttribute('tabindex')).toBe('0');
      expect(ul.getAttribute('aria-label')).toMatch(/still consistent$/);
    }
  });
});
