// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('main.ts loads hw-theme.js before its styles and its first render', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const at = main.indexOf("import './lib/hw-theme.js';");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("import css from './ui/styles.css?inline';"));
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
      ['--ink', '--doc-bg'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--muted', '--doc-bg'],
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent-ink', '--accent'],
      ['--bad', '--bg'],
      ['--bad', '--panel'],
      ['--bad', '--bad-soft'],
      ['--good', '--panel'],
      ['--good', '--doc-bg'],
      ['--ink', '--accent-soft'],
      ['--muted', '--accent-soft'],
      // The highlighted quotes in the document viewer.
      ['--ink', '--mark0'],
      ['--ink', '--mark1'],
      ['--ink', '--mark2'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Text fields' and the drop zone's edges: 3:1 against what they sit on (WCAG 1.4.11); --line was 1.23 to 1.47:1.
      for (const bg of ['--panel', '--bg', '--doc-bg']) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: field on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring (the accent) on what it surrounds.
      for (const bg of ['--panel', '--bg', '--doc-bg']) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
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
    // A drop zone's hover state (.drop.over) takes the accent on purpose.
    const own = BORDERS.filter((b) => matches(field, b.selector) && !/\.over\b/.test(b.selector));
    expect(own.length, field.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    for (const b of own) expect(b.value, `${b.selector} on ${field.outerHTML.slice(0, 120)}`).toContain('var(--field-border)');
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

describe('the switch in the header', () => {
  let app: HTMLElement;
  beforeAll(async () => {
    // jsdom has no matchMedia; the app asks it whether to scroll the viewer into view on a phone.
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    app = document.getElementById('app')!;
    await import('../src/main');
    await vi.waitFor(() => expect(app.querySelector('header')).not.toBeNull());
  });
  beforeEach(() => {
    window.hintwise!.theme!.set(null);
    localStorage.removeItem('hw-theme');
  });
  const tab = (t: 'ask' | 'check' | 'teach'): void => app.querySelector<HTMLButtonElement>(`[data-tab="${t}"]`)!.click();
  const button = (): HTMLButtonElement => app.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('sits in the header beside the title and says what it will do', () => {
    tab('ask');
    expectInTitleRow(app);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row, which is one line at every width', () => {
    const row = app.querySelector('hw-theme-toggle')!.parentElement!;
    const own = rulesFor(row);
    expect(own).toMatch(/display:\s*flex/);
    expect(own).toMatch(/justify-content:\s*space-between/);
    expect(own).not.toMatch(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap\b|display:\s*(block|grid)|(^|[\s;])(max-)?width\s*:/);
    // The header is a block, so the row takes the whole line (it was a wrapping flex row, where the switch could drop to a row of its own).
    expect(rulesFor(row.parentElement!)).not.toMatch(/display:\s*(inline-)?(flex|grid)/);
    expect(row.parentElement!.matches('header.site')).toBe(true);
    // The tagline and the course are under the title row, not beside the switch.
    expect(row.nextElementSibling?.classList.contains('site-meta')).toBe(true);
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

  it('stays in the header on every view and after every kind of answer', () => {
    for (const t of ['ask', 'check', 'teach', 'ask'] as const) {
      tab(t);
      expect(app.querySelector('main')!.children.length, t).toBeGreaterThan(0);
      expectInTitleRow(app);
    }
    // An answer, then a question the documents do not answer.
    app.querySelector<HTMLButtonElement>('[data-ask]')!.click();
    expect(app.textContent).toContain('The documents say');
    expectInTitleRow(app);
    const q = app.querySelector<HTMLInputElement>('#q')!;
    q.value = 'Is there a parking permit for the zoo?';
    app.querySelector('#askform')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(app.textContent).toContain('Not stated in the course documents');
    expectInTitleRow(app);
    // A checked quote.
    tab('check');
    app.querySelector<HTMLButtonElement>('[data-act="check-example"]')!.click();
    expect(app.textContent).toContain('Results');
    expectInTitleRow(app);
  });

  it('gives every text field on every view, and the drop zone, its border from --field-border (back on --line fails)', () => {
    const fields: Element[] = [];
    for (const t of ['ask', 'check', 'teach'] as const) {
      tab(t);
      fields.push(...app.querySelectorAll(FIELDS));
    }
    const kinds = new Set(fields.map((f) => f.tagName + (f.getAttribute('type') ?? '')));
    expect(kinds).toEqual(new Set(['INPUTsearch', 'TEXTAREA', 'INPUT', 'SELECT']));
    tab('teach');
    expectFieldToken([...fields, app.querySelector('#drop')!]);
  });

  it("puts no control inside another (axe nested-interactive), and shows the focus on the see-through file inputs' labels", () => {
    tab('teach');
    const drop = app.querySelector('#drop')!;
    // The drop zone holds the "choose files" button, so it is a named group, not a button itself.
    expect(drop.getAttribute('role')).toBe('group');
    expect(drop.getAttribute('aria-label')).toBe('Add files: PDF, Markdown or text');
    expect(drop.hasAttribute('tabindex')).toBe(false);
    for (const outer of app.querySelectorAll('button, [role="button"], a[href], [tabindex="0"]')) {
      expect(outer.querySelector('button, input, select, textarea, a[href], [tabindex="0"], [role="button"]'), outer.outerHTML.slice(0, 80)).toBeNull();
    }
    const inputs = [...app.querySelectorAll('.filebtn input[type="file"]')];
    expect(inputs.map((i) => i.id)).toEqual(['files', 'logs']);
    expect(rules('.filebtn input')).toMatch(/opacity:\s*0/);
    expect(rules('.filebtn:focus-within')).toMatch(/outline:\s*3px solid var\(--accent\)/);
  });
});
