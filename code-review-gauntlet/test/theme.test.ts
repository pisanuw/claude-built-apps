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
    expect(Object.keys(light)).toHaveLength(24);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text', '--panel'],
      ['--text', '--panel-2'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--muted', '--panel-2'],
      ['--muted', '--daily-tint'],
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent', '--panel-2'],
      ['--on-primary', '--primary'],
      ['--on-primary', '--primary-hover'],
      ['--good', '--panel'],
      ['--good', '--panel-2'],
      ['--bad', '--panel'],
      ['--bad', '--panel-2'],
      ['--warn', '--panel'],
      ['--warn', '--panel-2'],
      ['--warn', '--daily-tint'],
      ['--line-no', '--panel'],
      ['--grade-s', '--panel-2'],
      ['--cat-logic', '--panel-2'],
      ['--cat-null-safety', '--panel-2'],
      ['--cat-security', '--panel-2'],
      ['--cat-performance', '--panel-2'],
      ['--cat-style', '--panel-2'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // The focus ring.
      for (const bg of ["--bg", "--panel", "--panel-2"]) expect(ratio(rgb(t['--focus']), rgb(t[bg])), `${theme}: --focus on ${bg}`).toBeGreaterThanOrEqual(3);
      // The timer's fill on its track,
      for (const bg of ["--panel-2"]) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: --accent on ${bg}`).toBeGreaterThanOrEqual(3);
      // and when time is short.
      for (const bg of ["--panel-2"]) expect(ratio(rgb(t['--bad']), rgb(t[bg])), `${theme}: --bad on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--text']), rgb(t['--bg'])];
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
  beforeAll(async () => {
    await import('../src/lib/hw-theme.js');
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    mountApp(document.getElementById('app')!);
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
  });
  const root = (): HTMLElement => document.getElementById('app')!;
  const press = (text: string): void => [...root().querySelectorAll('button')].find((b) => b.textContent === text)!.click();
  const button = (): HTMLButtonElement => root().querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('ends the title row on every screen: the menu, a round and its result', () => {
    expectInTitleRow(root());
    expect(root().querySelector('header.masthead .title-row + .tagline')).not.toBeNull();
    root().querySelector<HTMLButtonElement>('button.tier-novice')!.click();
    // A round had no header and no h1; it has both now, the name smaller.
    expectInTitleRow(root());
    expect(root().querySelector('header.masthead.compact h1')!.textContent).toBe('Code Review Gauntlet');
    expect(rules('.masthead.compact h1')).toMatch(/font-size:\s*1\.25rem/);
    press('Submit review');
    expectInTitleRow(root());
    expect(root().querySelector('header.masthead.compact')).not.toBeNull();
    press('Back to menu');
    expectInTitleRow(root());
    expect(root().querySelector('header.masthead.compact')).toBeNull();
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
  });

  it('makes the code a named region in the tab order, in a round and on its result (axe: scrollable-region-focusable)', () => {
    root().querySelector<HTMLButtonElement>('button.tier-expert')!.click();
    expectRegion(root().querySelector('.code-panel'), 'The code under review');
    press('Submit review');
    expectRegion(root().querySelector('.code-panel'), 'The code, marked');
    expect(rules(':focus-visible')).toMatch(/outline:\s*3px solid var\(--focus\)/);
    press('Back to menu');
  });

  it('has no text field on any screen (one added needs a --field-border edge, 3:1)', () => {
    expect(root().querySelectorAll(FIELDS)).toHaveLength(0);
    root().querySelector<HTMLButtonElement>('button.tier-intermediate')!.click();
    expect(root().querySelectorAll(FIELDS)).toHaveLength(0);
    press('Submit review');
    expect(root().querySelectorAll(FIELDS)).toHaveLength(0);
    press('Back to menu');
  });

  it('lets a keyboard user flag a line: each is a toggle button, Enter and Space press it', () => {
    root().querySelector<HTMLButtonElement>('button.tier-novice')!.click();
    const lines = [...root().querySelectorAll<HTMLElement>('.code-panel .code-line')];
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect(line.getAttribute('role')).toBe('button');
      expect(line.tabIndex).toBe(0);
      expect(line.getAttribute('aria-pressed')).toBe('false');
      // Its name is its visible number and code.
      expect(line.hasAttribute('aria-label')).toBe(false);
    }
    const count = root().querySelector('.flag-count')!;
    expect(count.getAttribute('aria-live')).toBe('polite');
    const key = (line: HTMLElement, k: string): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      line.dispatchEvent(e);
      return e;
    };
    expect(key(lines[1], 'Enter').defaultPrevented).toBe(true);
    expect(lines[1].classList.contains('flagged')).toBe(true);
    expect(lines[1].getAttribute('aria-pressed')).toBe('true');
    expect(count.textContent).toBe('1 line flagged');
    expect(key(lines[2], ' ').defaultPrevented).toBe(true);
    expect(count.textContent).toBe('2 lines flagged');
    expect(key(lines[1], ' ').defaultPrevented).toBe(true);
    expect(lines[1].getAttribute('aria-pressed')).toBe('false');
    expect(count.textContent).toBe('1 line flagged');
    // Other keys are left alone (Tab moves on, arrows scroll the panel).
    expect(key(lines[3], 'ArrowRight').defaultPrevented).toBe(false);
    expect(key(lines[3], 'a').defaultPrevented).toBe(false);
    expect(lines[3].getAttribute('aria-pressed')).toBe('false');
    // A click still flags, and the result marks the flagged line a false flag or a find.
    lines[3].click();
    expect(lines[3].getAttribute('aria-pressed')).toBe('true');
    press('Submit review');
    expect(root().querySelectorAll('.code-panel .code-line.was-false, .code-panel .code-line.was-found').length).toBeGreaterThan(0);
    // On the result, the lines are not buttons any more.
    expect(root().querySelector('.code-panel .code-line[role="button"]')).toBeNull();
    expect(rules('.code-line:focus-visible')).toMatch(/outline-offset:\s*-3px/);
    press('Back to menu');
  });

  it('puts the seconds beside the timer bar, not over its fill (2.14:1 there in dark)', () => {
    root().querySelector<HTMLButtonElement>('button.tier-novice')!.click();
    const timer = root().querySelector('.timer')!;
    const text = timer.querySelector('.timer-text')!;
    expect(text.textContent).toMatch(/^\d+s$/);
    expect(text.closest('.timer-track')).toBeNull();
    expect(timer.querySelector('.timer-track > .timer-fill')).not.toBeNull();
    expect(rules('.timer-text')).not.toMatch(/position:\s*absolute/);
    expect(rules('.timer-text')).toMatch(/color:\s*var\(--text\)/);
    press('Abandon');
  });

  it('gives the primary buttons their own text colour, and the ink on paper', () => {
    expect(rules('button.primary')).toMatch(/color:\s*var\(--on-primary\)/);
    const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
    expect(print).toMatch(/button\.primary\s*\{\s*color:\s*var\(--text\);?\s*\}/);
    // The print block comes after the rule it overrides, which has the same specificity.
    expect(css.match(/@media print/g)).toHaveLength(1);
    expect(css.indexOf('@media print')).toBeGreaterThan(css.indexOf('button.primary {'));
  });
});

describe('the code on its tints', () => {
  // Flagged, found, missed and false lines sit on a translucent tint over the code panel.
  const value = (re: RegExp, name: string): string => (css.match(re)?.[1] ?? '').match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? '';
  const LIGHT = /:root\s*\{([^}]*)\}/;
  const DARK = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
  const rgba = (v: string): [number[], number] => {
    const m = v.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
    return [[+m[1], +m[2], +m[3]], +m[4]];
  };
  it('is 4.5:1 in both themes, line numbers too (#4d5a6e was 2.47:1)', () => {
    for (const re of [LIGHT, DARK]) {
      const get = (n: string): string => value(re, n) || value(LIGHT, n);
      for (const [fg, tint] of [
        ['--text', '--line-hover'],
        ['--text', '--flag-bg'],
        ['--text', '--found-bg'],
        ['--text', '--missed-bg'],
        ['--text', '--false-bg'],
        ['--line-no', '--line-hover'],
        ['--flag', '--flag-bg'],
        ['--line-no', '--found-bg'],
        ['--line-no', '--missed-bg'],
        ['--line-no', '--false-bg'],
      ]) {
        const [c, a] = rgba(get(tint));
        expect(ratio(rgb(get(fg)), mix(c, rgb(get('--panel')), a)), `${fg} on ${tint}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

