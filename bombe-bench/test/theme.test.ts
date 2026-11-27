// @vitest-environment jsdom
// The light and dark mode switch (platform/src/theme/README.md, "The test an app copies").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBombeRun, type BombeOptions } from '../src/core/bombe';
import { App } from '../src/ui/app';

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
    expect(Object.keys(light)).toHaveLength(20);
    expect(block(/:root\s*\{([^}]*)\}/)).toContain('color-scheme: light;');
    expect(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)).toContain('color-scheme: dark;');
  });

  it('meets WCAG AA for text, and 3:1 for field edges and the other edges it lists, in both themes', () => {
    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text', '--panel'],
      ['--text', '--box'],
      ['--text', '--lamp'],
      ['--muted', '--bg'],
      ['--muted', '--panel'],
      ['--muted', '--box'],
      ['--accent', '--bg'],
      ['--accent', '--panel'],
      ['--accent-text', '--accent'],
      ['--ok', '--panel'],
      ['--bad', '--panel'],
      ['--on-lit', '--lamp-lit'],
      ['--on-lit', '--fwd'],
      ['--on-bad', '--bad'],
    ];
    for (const [theme, t] of [['light', light], ['dark', { ...light, ...dark }]] as const) {
      for (const [fg, bg] of text) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      // Fields' and buttons' edges (WCAG 1.4.11): --border was 1.48:1.
      for (const bg of ["--panel", "--bg", "--box"]) expect(ratio(rgb(t['--field-border']), rgb(t[bg])), `${theme}: --field-border on ${bg}`).toBeGreaterThanOrEqual(3);
      // The wiring paths: forward (#e8740c was 2.85:1 on the boxes in light),
      for (const bg of ["--panel", "--box"]) expect(ratio(rgb(t['--fwd']), rgb(t[bg])), `${theme}: --fwd on ${bg}`).toBeGreaterThanOrEqual(3);
      // back,
      for (const bg of ["--panel", "--box"]) expect(ratio(rgb(t['--bwd']), rgb(t[bg])), `${theme}: --bwd on ${bg}`).toBeGreaterThanOrEqual(3);
      // and through the reflector (#9c36b5 was 2.92:1 on the dark panel).
      for (const bg of ["--panel", "--box"]) expect(ratio(rgb(t['--refl']), rgb(t[bg])), `${theme}: --refl on ${bg}`).toBeGreaterThanOrEqual(3);
      // The focus ring on the scroll regions.
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

// jsdom has no Worker: the Bombe runs here until a stop passes the checking machine (the stop the tab then
// shows), and answers as the worker does.
vi.mock('../src/worker/bombe.worker?worker', () => ({
  default: class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage(req: { options: BombeOptions }): void {
      const run = createBombeRun(req.options);
      while (!run.stops.some((st) => st.checked) && run.next()) {
        /* to the first stop that passes */
      }
      queueMicrotask(() => this.onmessage?.({ data: { type: 'done', stops: run.stops, stopCount: run.stopCount, configsDone: run.configsDone, ms: 1 } }));
    }
    terminate(): void {}
  },
}));

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
    new App(root);
  });
  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const tab = (name: string): void => $<HTMLButtonElement>(`button[data-tab="${name}"]`).click();
  const button = (): HTMLButtonElement => root.querySelector('header hw-theme-toggle')!.shadowRoot!.querySelector('button')!;

  it('ends the title row, which takes the header line before the tagline and tabs, and says what it will do', () => {
    expectInTitleRow(root);
    const header = root.querySelector('header')!;
    expect([...header.children].map((k) => k.className || k.tagName)).toEqual(['title-row', 'tagline', 'tabs']);
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('stays at the end of the title row on every tab', () => {
    for (const name of ['attack', 'challenge', 'machine']) {
      tab(name);
      expectInTitleRow(root);
    }
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

  it('gives every text field on every tab its edge from --field-border (back on --border fails)', () => {
    tab('challenge');
    $<HTMLButtonElement>('#c-generate').click();
    expectFieldToken([...root.querySelectorAll(FIELDS)]);
    expect(rules('input')).toMatch(/border:\s*1px solid var\(--field-border\)/);
  });

  it('makes the wide boxes named regions in the tab order, and names the challenge link', async () => {
    expectRegion($('#m-wiring'), 'Wiring diagram');
    tab('attack');
    $<HTMLButtonElement>('#a-example').click();
    expectRegion($('#a-strip'), 'The crib under the ciphertext');
    $<HTMLButtonElement>('#a-run').click();
    await vi.waitFor(() => expect(root.querySelector('table.stops')).not.toBeNull(), { timeout: 20_000 });
    expectRegion(root.querySelector('table.stops')!.parentElement, 'Bombe stops');
    for (const sel of ['.wiring-wrap:focus-visible', '.strip:focus-visible', '.table-scroll:focus-visible']) expect(rules(sel), sel).toMatch(/outline:\s*2px solid var\(--accent\)/);
    tab('challenge');
    $<HTMLButtonElement>('#c-generate').click();
    expect($('#c-link').getAttribute('aria-label')).toBe('Challenge link');
  }, 30_000);

  it('makes the menu graph a group of buttons, not an image that holds buttons (axe: nested-interactive)', () => {
    tab('attack');
    $<HTMLButtonElement>('#a-example').click();
    const svg = root.querySelector('svg.menu-graph')!;
    expect(svg.getAttribute('role')).toBe('group');
    expect(svg.getAttribute('aria-label')).toBe('Menu graph');
    expect(svg.querySelectorAll('[role="button"][tabindex="0"]').length).toBeGreaterThan(2);
  });
});

describe("a selected stop's tint", () => {
  // The selected row is --under (a tint of the forward orange) over the panel; its verdicts are text on it.
  const value = (re: RegExp, name: string): string => (css.match(re)?.[1] ?? '').match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? '';
  const LIGHT = /:root\s*\{([^}]*)\}/;
  const DARK = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
  const rgba = (v: string): [number[], number] => {
    const m = v.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
    return [[+m[1], +m[2], +m[3]], +m[4]];
  };
  it('keeps the checking machine verdicts 4.5:1 in both themes (#1f7a3d and #c0392b were 4.24 and 4.29:1)', () => {
    for (const re of [LIGHT, DARK]) {
      const get = (n: string): string => value(re, n) || value(LIGHT, n);
      const [tint, alpha] = rgba(get('--under'));
      const row = mix(tint, rgb(get('--panel')), alpha);
      for (const n of ['--ok', '--bad', '--text']) expect(ratio(rgb(get(n)), row), n).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('on paper (batch 5 review R1-2)', () => {
  // Paper leaves CSS fills out, so a white label on a fill would print pale grey (about 2.3:1).
  const print = [...css.matchAll(PRINT)].map((m) => m[1]).join('\n');
  const printRules = (selector: string): string =>
    [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.split(',').some((x) => x.trim() === selector)).map((m) => m[2]).join(';');
  const CONTROLS = [".tabs button.active", "button.primary", ".chip.on"];
  const CURRENT = [".tabs button.active", ".chip.on"];
  const CONTENT: string[] = [".tape mark", ".lamp.lit", ".cell.clash"];

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
      .filter(([, , body]) => /(?:^|;)\s*color:\s*var\((?:--accent-text|--on-lit|--on-bad)\)/.test(body) && /background(?:-color)?:\s*var\(/.test(body))
      .flatMap(([, s]) => s.split(',').map((x) => x.trim().replace(/\s+/g, ' ')));
    expect(filled.length).toBeGreaterThan(0);
    for (const sel of filled) expect([...CONTROLS, ...CONTENT], sel).toContain(sel);
  });
});

