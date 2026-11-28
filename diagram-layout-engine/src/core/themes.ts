// Themes are sets of CSS custom properties. The SVG only ever refers to
// var(--dle-*), so switching theme (or following the OS dark mode) restyles a
// diagram without laying it out again.

export interface Theme {
  id: string;
  label: string;
  dark: boolean;
  vars: Record<string, string>;
}

const base = {
  '--dle-font': 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

export const THEMES: Theme[] = [
  {
    id: 'light',
    label: 'Light',
    dark: false,
    vars: {
      ...base,
      '--dle-bg': '#ffffff',
      '--dle-node-fill': '#eef2ff',
      '--dle-node-stroke': '#6366f1',
      '--dle-node-text': '#1e1b4b',
      '--dle-edge': '#475569',
      '--dle-label-bg': '#ffffff',
      '--dle-label-text': '#334155',
      '--dle-cluster-fill': '#f8fafc',
      '--dle-cluster-stroke': '#cbd5e1',
      '--dle-cluster-text': '#475569',
      '--dle-added': '#16a34a',
      '--dle-added-fill': '#dcfce7',
      '--dle-removed': '#dc2626',
      '--dle-removed-fill': '#fee2e2',
      '--dle-changed': '#d97706',
      '--dle-changed-fill': '#fef3c7',
      '--dle-focus': '#f43f5e',
    },
  },
  {
    id: 'dark',
    label: 'Dark',
    dark: true,
    vars: {
      ...base,
      '--dle-bg': '#0f172a',
      '--dle-node-fill': '#1e293b',
      '--dle-node-stroke': '#818cf8',
      '--dle-node-text': '#e2e8f0',
      '--dle-edge': '#94a3b8',
      '--dle-label-bg': '#0f172a',
      '--dle-label-text': '#cbd5e1',
      '--dle-cluster-fill': '#111c33',
      '--dle-cluster-stroke': '#334155',
      '--dle-cluster-text': '#94a3b8',
      '--dle-added': '#4ade80',
      '--dle-added-fill': '#14532d',
      '--dle-removed': '#f87171',
      '--dle-removed-fill': '#7f1d1d',
      '--dle-changed': '#fbbf24',
      '--dle-changed-fill': '#78350f',
      '--dle-focus': '#fb7185',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    dark: false,
    vars: {
      ...base,
      '--dle-bg': '#fbfdf8',
      '--dle-node-fill': '#e3f1d4',
      '--dle-node-stroke': '#3f7d20',
      '--dle-node-text': '#1f3b0f',
      '--dle-edge': '#4d5f3a',
      '--dle-label-bg': '#fbfdf8',
      '--dle-label-text': '#2f4421',
      '--dle-cluster-fill': '#f2f8ea',
      '--dle-cluster-stroke': '#a9c98a',
      '--dle-cluster-text': '#3f5a2a',
      '--dle-added': '#15803d',
      '--dle-added-fill': '#bbf7d0',
      '--dle-removed': '#b91c1c',
      '--dle-removed-fill': '#fecaca',
      '--dle-changed': '#b45309',
      '--dle-changed-fill': '#fde68a',
      '--dle-focus': '#be123c',
    },
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    dark: true,
    vars: {
      ...base,
      '--dle-font': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      '--dle-bg': '#0b3a6e',
      '--dle-node-fill': '#0d4785',
      '--dle-node-stroke': '#e0f2fe',
      '--dle-node-text': '#f0f9ff',
      '--dle-edge': '#bae6fd',
      '--dle-label-bg': '#0b3a6e',
      '--dle-label-text': '#e0f2fe',
      '--dle-cluster-fill': '#0a4279',
      '--dle-cluster-stroke': '#7dd3fc',
      '--dle-cluster-text': '#bae6fd',
      '--dle-added': '#86efac',
      '--dle-added-fill': '#14532d',
      '--dle-removed': '#fca5a5',
      '--dle-removed-fill': '#7f1d1d',
      '--dle-changed': '#fde047',
      '--dle-changed-fill': '#713f12',
      '--dle-focus': '#fde047',
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    dark: false,
    vars: {
      ...base,
      '--dle-font': 'Georgia, "Iowan Old Style", "Times New Roman", serif',
      '--dle-bg': '#fbf6ec',
      '--dle-node-fill': '#f3e7cf',
      '--dle-node-stroke': '#8a5a2b',
      '--dle-node-text': '#3b2a17',
      '--dle-edge': '#7a5c3e',
      '--dle-label-bg': '#fbf6ec',
      '--dle-label-text': '#4a3520',
      '--dle-cluster-fill': '#f7eedc',
      '--dle-cluster-stroke': '#d1b58c',
      '--dle-cluster-text': '#6b4a2a',
      '--dle-added': '#3f7d20',
      '--dle-added-fill': '#e3f1d4',
      '--dle-removed': '#a3261b',
      '--dle-removed-fill': '#f7d6d0',
      '--dle-changed': '#a16207',
      '--dle-changed-fill': '#fdecc8',
      '--dle-focus': '#a3261b',
    },
  },
  {
    id: 'contrast',
    label: 'High contrast',
    dark: false,
    vars: {
      ...base,
      '--dle-bg': '#ffffff',
      '--dle-node-fill': '#ffffff',
      '--dle-node-stroke': '#000000',
      '--dle-node-text': '#000000',
      '--dle-edge': '#000000',
      '--dle-label-bg': '#ffff00',
      '--dle-label-text': '#000000',
      '--dle-cluster-fill': '#ffffff',
      '--dle-cluster-stroke': '#000000',
      '--dle-cluster-text': '#000000',
      '--dle-added': '#006100',
      '--dle-added-fill': '#c6efce',
      '--dle-removed': '#9c0006',
      '--dle-removed-fill': '#ffc7ce',
      '--dle-changed': '#7a4f00',
      '--dle-changed-fill': '#ffeb9c',
      '--dle-focus': '#0000ff',
    },
  },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

function block(selector: string, vars: Record<string, string>): string {
  return `${selector}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;
}

/**
 * CSS declaring the theme variables on `selector`. 'auto' gives the light
 * theme, and the dark one on screen:
 * - in the page, when its switch says dark (data-theme on <html>), or when
 *   the device prefers dark and the switch has not chosen light, as the
 *   page's own colours do. These two rules need <html> above the SVG;
 * - in an exported SVG opened on its own, where the <svg> is the document's
 *   root (`selector:root`) and there is no switch, when the viewer's device
 *   prefers dark. In the page the inline <svg> is never the root, so this
 *   rule does not apply there.
 * Paper keeps the light theme.
 */
export function themeCss(themeId: string, selector: string): string {
  if (themeId === 'auto') {
    const dark = themeById('dark').vars;
    return (
      block(selector, themeById('light').vars) +
      `@media screen{${block(`:root[data-theme="dark"] ${selector}`, dark)}}` +
      `@media screen and (prefers-color-scheme: dark){${block(`:root:not([data-theme="light"]) ${selector}`, dark)}${block(`${selector}:root`, dark)}}`
    );
  }
  return block(selector, themeById(themeId).vars);
}
