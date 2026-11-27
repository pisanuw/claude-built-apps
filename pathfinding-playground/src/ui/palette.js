// The canvas's colours are the stylesheet's tokens (src/styles.css), read each
// time the map is drawn, so the canvas follows the light and dark switch. The
// light values stand in where no stylesheet is loaded (the tests, which also
// check that they match the stylesheet's light set).

export const TOKENS = {
  paper: ['--paper', '#f4f8fb'],
  line: ['--line', '#c9d8e4'],
  ink: ['--ink', '#14304a'],
  inkSoft: ['--ink-soft', '#3e5c77'],
  route: ['--route', '#b5381c'],
  green: ['--green', '#1e7a5a'],
  sand: ['--sand', '#d9bc8c'],
  sandLine: ['--sand-line', '#b08d54'],
  visited: ['--visited', 'rgba(169, 196, 219, 0.62)'],
  frontier: ['--frontier', 'rgba(232, 155, 20, 0.8)'],
  costVisited: ['--cost-visited', 'rgba(20, 48, 74, 0.75)'],
  costFrontier: ['--cost-frontier', '#5c3a00'],
};

export function readPalette(el = document.documentElement) {
  const style = getComputedStyle(el);
  return Object.fromEntries(
    Object.entries(TOKENS).map(([key, [name, light]]) => [key, style.getPropertyValue(name).trim() || light]),
  );
}
