// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { vivaId } from '../src/core/pack';
import { mountInstructor } from '../src/ui/instructor';
import { mountStudent } from '../src/ui/student';
import { viva } from './fixtures';

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
    expect(main.indexOf("import './lib/hw-theme.js';")).toBeLessThan(main.indexOf('mountInstructor('));
  });
});

describe('the palette', () => {
  const block = (re: RegExp): string | undefined => css.match(re)?.[1].replace(/\s+/g, ' ').trim();
  const tokens = (re: RegExp): Record<string, string> =>
    Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  const light = tokens(/:root\s*\{([^}]*)\}/);
  const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
  const lightCss = block(/:root\s*\{([^}]*)\}/)!;
  const darkCss = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)!;

  it('is the same for the switch and for the device setting', () => {
    const attr = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(attr).toBeTruthy();
    expect(block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)).toBe(attr);
  });

  it('sets every colour the light theme sets', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light)).toHaveLength(12);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
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

  it('meets WCAG AA for text, and 3:1 for field borders, in both themes', () => {
    const text: [string, string][] = [
      ['--fg', '--bg'],
      ['--fg', '--card'],
      ['--muted', '--bg'],
      ['--muted', '--card'],
      ['--accent', '--bg'],
      ['--accent', '--card'],
      ['--accent-fg', '--accent'],
      ['--good', '--bg'],
      ['--good', '--card'],
      ['--warn', '--bg'],
      ['--warn', '--card'],
      ['--bad', '--bg'],
      ['--bad', '--card'],
      ['--fg', '--code-bg'],
      ['--muted', '--code-bg'],
    ];
    for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' edges: 3:1 against what they sit on (WCAG 1.4.11).
      for (const bg of ['--card', '--bg', '--code-bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The demo bar's select sits on --accent-soft, which is translucent, over the page (.demo-bar replaces the card's background).
      const soft = (theme === 'light' ? lightCss : darkCss).match(/--accent-soft:\s*rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!.slice(1).map(Number);
      const page = rgb(t['--bg']);
      const tint = page.map((v, i) => soft[3] * soft[i] + (1 - soft[3]) * v);
      expect(ratio(rgb(t['--field-border']), tint), `${theme}: field on the demo bar`).toBeGreaterThanOrEqual(3);
      // A warning badge (--warn on --warn-soft) in a selected row (--accent-soft) of a card.
      const rgba = (name: string): number[] => (theme === 'light' ? lightCss : darkCss).match(new RegExp(`${name}:\\s*rgba\\((\\d+), (\\d+), (\\d+), ([\\d.]+)\\)`))!.slice(1).map(Number);
      const over = (c: number[], below: number[]): number[] => below.map((v, i) => c[3] * c[i] + (1 - c[3]) * v);
      const badge = over(rgba('--warn-soft'), over(rgba('--accent-soft'), rgb(t['--card'])));
      expect(ratio(rgb(t['--warn']), badge), `${theme}: warning badge in a selected row`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, dark]) {
      // The header sits on the page: --fg on --bg.
      const [ink, bg] = [rgb(t['--fg']), rgb(t['--bg'])];
      const outline = ink.map((v, i) => share * v + (1 - share) * bg[i]);
      expect(ratio(outline, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes no colour outside the token blocks', () => {
    // None: every colour is a token.
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

  it('prints with the light set and without the switch: both dark blocks are for screens only', () => {
    // Paper is white (browsers leave backgrounds out), so the dark set's pale text would not read there.
    const screenAttr = /@media\s+screen\s*\{\s*:root\[data-theme="dark"\]\s*\{[^}]*\}\s*\}/;
    const screenDevice = /@media\s+screen\s+and\s+\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}\s*\}/;
    expect(css).toMatch(screenAttr);
    expect(css).toMatch(screenDevice);
    // No other rule follows the theme or the device setting, which print would then follow too.
    expect(css.replace(screenAttr, '').replace(screenDevice, '')).not.toMatch(/data-theme|prefers-color-scheme/);
    const print = [...css.matchAll(/@media\s+print\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/(?:^|[\s,}])hw-theme-toggle\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});

// The title row: the title and the switch, alone on a row that takes the header's whole
// width (.title-row is a flex row with space-between and flex-basis 100%), so nothing
// else in the header can sit beside the switch or push it off the end.
function expectTitleRow(header: Element): void {
  const toggle = header.querySelector('hw-theme-toggle')!;
  const row = toggle.parentElement!;
  expect(row.className).toBe('title-row');
  expect(row.parentElement).toBe(header);
  expect([...row.children].map((c) => c.tagName)).toEqual(['H1', 'HW-THEME-TOGGLE']);
  const rule = css.match(/\.title-row\s*\{([^}]*)\}/)![1];
  for (const decl of ['display: flex;', 'justify-content: space-between;', 'flex-basis: 100%;']) expect(rule).toContain(decl);
}

// A box that scrolls sideways must be reachable by keyboard: tabindex 0, a region, a name.
function expectRegions(root: Element, atLeast: number): void {
  const wraps = [...root.querySelectorAll('.table-wrap')];
  expect(wraps.length).toBeGreaterThanOrEqual(atLeast);
  for (const w of wraps) {
    expect(w.getAttribute('tabindex'), w.outerHTML.slice(0, 80)).toBe('0');
    expect(w.getAttribute('role')).toBe('region');
    expect(w.getAttribute('aria-label')).toBeTruthy();
  }
}

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
    mountInstructor(root);
  });
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the header beside the title and says what it will do', () => {
    const toggle = root.querySelector('header hw-theme-toggle')!;
    expect(toggle.previousElementSibling?.tagName).toBe('H1');
    expect(root.querySelectorAll('hw-theme-toggle')).toHaveLength(1);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('keeps the switch at the end of the title row at every width (the lede comes below)', () => {
    expectTitleRow(root.querySelector('header')!);
    expect(root.querySelector('header')!.lastElementChild?.className).toBe('lede');
  });

  it('makes every wide table a focusable, labelled region, before and after a demo is loaded', () => {
    expectRegions(root, 1); // the guide's table
    root.querySelector<HTMLButtonElement>('#demo')!.click();
    expectRegions(root, 1); // the review tab: all students
    root.querySelector<HTMLButtonElement>('[data-tab="import"]')!.click();
    expectRegions(root, 1); // the import tab: the submissions
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

  it('gives every text field its border from --field-border (a field back on another colour fails)', () => {
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
    const fields = root.querySelectorAll(
      'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
    );
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const own = borders.filter((b) => matches(field, b.selector));
      expect(own.length, field.outerHTML).toBeGreaterThan(0);
      for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML}`).toContain('var(--field-border)');
    }
  });
});

describe("the switch in the student's pages", () => {
  let root: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
  });
  const toggles = (): Element[] => [...root.querySelectorAll('hw-theme-toggle')];

  it('the session page has it in its header, beside the title', () => {
    mountStudent(root, viva());
    expect(toggles()).toHaveLength(1);
    expect(toggles()[0].closest('header')?.querySelector('h1')?.textContent).toBe('Code Viva');
    expectTitleRow(root.querySelector('header')!);
  });

  it('the timed question page has it in a header for the whole session', () => {
    vi.useFakeTimers();
    try {
      mountStudent(root, viva());
      root.querySelector<HTMLButtonElement>('#start')!.click();
      expect(root.querySelector('#answer')).not.toBeNull();
      expect(toggles()).toHaveLength(1);
      expect(toggles()[0].parentElement?.tagName).toBe('HEADER');
      // The header holds only the switch, pushed to its end.
      expect(toggles()[0].parentElement?.children).toHaveLength(1);
      expect(css).toMatch(/\.top > hw-theme-toggle\s*\{\s*margin-left: auto;/);
    } finally {
      window.onbeforeunload = null;
      vi.useRealTimers();
    }
  });

  it('the finished page and the damaged-link page have it in a header too', () => {
    const v = viva();
    localStorage.setItem(`code-viva-session-${vivaId(v)}`, JSON.stringify({ response: 'CV1.response' }));
    mountStudent(root, v);
    expect(root.querySelector('#done-h')).not.toBeNull();
    expect(toggles()).toHaveLength(1);
    expect(toggles()[0].parentElement?.tagName).toBe('HEADER');
    mountStudent(root, null);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(toggles()).toHaveLength(1);
    expectTitleRow(root.querySelector('header')!);
  });
});
