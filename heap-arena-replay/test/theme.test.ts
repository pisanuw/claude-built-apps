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
    expect(Object.keys(light)).toHaveLength(34);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text', '--panel'],
      ['--text', '--cell'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--muted', '--cell'],
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent-text', '--accent'],
      ['--ok', '--panel'],
      ['--bad', '--panel'],
      ['--warn', '--panel'],
      ['--text', '--payload'],
      ['--text', '--padding'],
      ['--text', '--freespace'],
      ['--text', '--ptr'],
      ['--text', '--sys'],
      ['--series-0', '--panel'],
      ['--series-0', '--cell'],
      ['--series-1', '--panel'],
      ['--series-1', '--cell'],
      ['--series-2', '--panel'],
      ['--series-2', '--cell'],
      ['--series-3', '--panel'],
      ['--series-3', '--cell'],
      ['--series-4', '--panel'],
      ['--series-4', '--cell'],
      ['--series-5', '--panel'],
      ['--series-5', '--cell'],
      ['--series-6', '--panel'],
      ['--series-6', '--cell'],
      ['--series-7', '--panel'],
      ['--series-7', '--cell'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields' and buttons' edges (WCAG 1.4.11): --border was 1.35 to 1.48:1.
      for (const bg of ["--panel", "--bg", "--cell"]) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
      // The highlighted blocks' outlines on the cells: examined (#e8740c was 2.84:1 in light),
      for (const bg of ["--cell", "--panel"]) expect(ratio(rgb(t['--examined']), rgb(t[bg])), `${theme}: --examined on ${bg}`).toBeGreaterThanOrEqual(3);
      // chosen,
      for (const bg of ["--cell"]) expect(ratio(rgb(t['--result']), rgb(t[bg])), `${theme}: --result on ${bg}`).toBeGreaterThanOrEqual(3);
      // split
      for (const bg of ["--cell"]) expect(ratio(rgb(t['--split']), rgb(t[bg])), `${theme}: --split on ${bg}`).toBeGreaterThanOrEqual(3);
      // and freed.
      for (const bg of ["--cell"]) expect(ratio(rgb(t['--freed']), rgb(t[bg])), `${theme}: --freed on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring.
      for (const bg of ["--panel", "--bg"]) expect(ratio(rgb(t['--accent']), rgb(t[bg])), `${theme}: --accent on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the switch's outline 3:1 against the header, in both themes", () => {
    // hw-theme.js draws the outline as a share of the text colour over what is behind it.
    const share = Number(readFileSync('src/lib/hw-theme.js', 'utf8').match(/currentColor (\d+)%/)![1]) / 100;
    expect(share).toBeGreaterThan(0);
    for (const t of [light, { ...light, ...dark }]) {
      const [ink, bg] = [rgb(t['--text']), rgb(t['--panel'])];
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
  const tab = (key: string): void => root.querySelector<HTMLButtonElement>(`button[data-tab="${key}"]`)!.click();
  const press = (label: string): void => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!.click();
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('ends the title row, which takes the header line before the tagline, tabs and link, and says what it will do', () => {
    expectInTitleRow(root);
    expect([...root.querySelector('header')!.children].map((k) => k.className || k.tagName)).toEqual(['title-row', 'tag', 'tabs', 'ext']);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row on every tab', () => {
    for (const key of ['compare', 'quiz', 'diff', 'about', 'replay']) {
      tab(key);
      expectInTitleRow(root);
    }
    // The five tabs wrap on a narrow phone instead of widening the page (340 px at 320).
    expect(rules('nav.tabs')).toMatch(/flex-wrap:\s*wrap/);
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

  it("ignores the step keys typed in a field, also in a shadow root (it reads composedPath()[0], not the retargeted host)", () => {
    const host = document.createElement('div');
    document.body.append(host);
    const field = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('input'));
    const inField = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true });
    field.dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
    const onPage = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    document.body.dispatchEvent(onPage);
    expect(onPage.defaultPrevented).toBe(true);
  });

  it('leaves the step keys to a scroll region, so it scrolls sideways and keeps the focus (batch 5 review R1-1)', () => {
    tab('replay');
    const label = (): string => root.querySelector('.steplabel')!.textContent!;
    const region = (): HTMLElement => root.querySelector<HTMLElement>('.tablewrap[role="region"]')!;
    expect(region().getAttribute('aria-label')).toBe('Operations');
    const before = label();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      const inRegion = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      // A key on a cell inside the region counts too.
      (region().querySelector('td') ?? region()).dispatchEvent(inRegion);
      expect(inRegion.defaultPrevented, key).toBe(false);
      expect(label(), key).toBe(before);
    }
    // The page itself, and the replay's own buttons, keep the shortcut.
    const onPage = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    document.body.dispatchEvent(onPage);
    expect(onPage.defaultPrevented).toBe(true);
    expect(label()).not.toBe(before);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(label()).toBe(before);
  });

  it('gives every text field its edge from --field-border (back on --border fails)', () => {
    for (const key of ['replay', 'quiz', 'diff']) {
      tab(key);
      expectFieldToken([...root.querySelectorAll(FIELDS)]);
    }
  });

  it('makes the boxes that scroll named regions in the tab order, with the focus ring', () => {
    // Every table box and trace box each tab draws is a named region.
    const names = new Set<string>();
    const collect = (): void => {
      for (const b of root.querySelectorAll('.tablewrap, pre.ctx')) {
        expectRegion(b, b.getAttribute('aria-label') ?? '(no name)');
        names.add(b.getAttribute('aria-label')!);
      }
    };
    press('Last');
    const words = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => /word/i.test(c.parentElement?.textContent ?? ''))!;
    words.click();
    collect();
    tab('compare');
    collect();
    tab('quiz');
    // The quiz's own Generate (the side panel has one for traces).
    [...root.querySelectorAll<HTMLButtonElement>('main button')].filter((b) => b.textContent === 'Generate').at(-1)!.click();
    collect();
    tab('about');
    collect();
    expect([...names].sort()).toEqual(['Operations', 'Placement policies compared', 'The trace so far', 'Trace format', 'Words']);
    for (const sel of ['.tablewrap:focus-visible', 'pre.ctx:focus-visible']) expect(rules(sel), sel).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('names each chart, and draws its lines and the free lists in the --series tokens, so they follow the theme', () => {
    const names: string[] = [];
    names.push(...[...root.querySelectorAll('svg.chart')].map((c) => c.getAttribute('aria-label')!));
    tab('compare');
    names.push(...[...root.querySelectorAll('svg.chart')].map((c) => c.getAttribute('aria-label')!));
    expect([...new Set(names)].sort()).toEqual(['Blocks examined (cumulative), by policy', 'External fragmentation, by policy', 'Utilization and fragmentation over the trace', 'Utilization, by policy']);
    const lines = [...root.querySelectorAll<SVGPathElement>('svg.chart path.series')];
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) {
      expect(l.style.stroke).toMatch(/^var\(--series-[0-7]\)$/);
      expect(l.hasAttribute('stroke')).toBe(false);
    }
    for (let i = 0; i < 8; i += 1) expect(rules(`svg.strip .c${i}`)).toMatch(new RegExp(`stroke:\\s*var\\(--series-${i}\\);\\s*fill:\\s*var\\(--series-${i}\\)`));
  });
});

describe('on paper (batch 5 review R1-2)', () => {
  // Paper leaves CSS fills out, so a white label on a fill would print pale grey (about 2.3:1).
  const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
  const printRules = (selector: string): string =>
    [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
  const CONTROLS = [".tab.active", "button.primary"];
  const CURRENT = [".tab.active"];
  const CONTENT: string[] = [];

  it('prints a filled control\'s label in the ink, the current one underlined, and keeps the fills that are content', () => {
    for (const sel of CONTROLS) expect(printRules(sel), sel).toMatch(/(?:^|;)\s*color:\s*var\(--text\)/);
    for (const sel of CURRENT) expect(printRules(sel), sel).toMatch(/text-decoration:\s*underline/);
    for (const sel of CONTENT) expect(printRules(sel), sel).toMatch(/print-color-adjust:\s*exact;\s*-webkit-print-color-adjust:\s*exact/);
    // One print block, at the end, so it wins over the screen rules of the same specificity.
    expect(css.match(/@media print/g)).toHaveLength(1);
    expect(css.slice(css.indexOf('@media print')).match(PRINT)![0].length).toBe(css.slice(css.indexOf('@media print')).trimEnd().length);
  });

  it('lists every screen rule that puts a label colour for a fill on one, so a new one has to be added', () => {
    const screen = css.replace(PRINT, '').replace(SCREEN_ATTR, '').replace(SCREEN_DEVICE, '').replace(/:root\s*\{[^}]*\}/g, '');
    const filled = [...screen.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(?:^|;)\s*color:\s*var\((?:--accent-text)\)/.test(body) && /background(?:-color)?:\s*var\(/.test(body))
      .flatMap(([, s]) => s.split(',').map((x) => x.trim().replace(/\s+/g, ' ')));
    expect(filled.length).toBeGreaterThan(0);
    for (const sel of filled) expect([...CONTROLS, ...CONTENT], sel).toContain(sel);
  });
});

