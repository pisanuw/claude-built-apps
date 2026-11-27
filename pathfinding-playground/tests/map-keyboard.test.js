// @vitest-environment jsdom
// Editing the map by keyboard (WCAG 2.1.1): walls, mud and the start and goal pins could be placed only with a
// pointer. The focused map now takes the keys, and a live region says what its cursor is on and what changed.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { describeCell } from '../src/ui/GridCanvas.jsx';
import { makeGrid, MUD, WALL } from '../src/engine/grid.js';

// jsdom has no canvas: a 2D context that keeps the stroke colours it is given.
const strokes = [];
const fakeContext = new Proxy(
  {},
  {
    get: (_t, key) => (key === 'measureText' ? () => ({ width: 12 }) : () => {}),
    set: (_t, key, value) => {
      if (key === 'strokeStyle') strokes.push(value);
      return true;
    },
  },
);

describe('editing the map by keyboard', () => {
  let root;
  let app;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    HTMLCanvasElement.prototype.getContext = () => fakeContext;
    // An empty Small map, so every cell's content is known: start at row 8, column 3, the goal at row 8, column 20 (counted from 1).
    window.location.hash = '';
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
    app = createRoot(root);
    act(() => app.render(createElement(App)));
    act(() => {
      const select = root.querySelector('select');
      select.value = '0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  afterAll(() => {
    act(() => app.unmount());
    HTMLCanvasElement.prototype.getContext = realGetContext;
    vi.unstubAllGlobals();
  });

  const map = () => root.querySelector('canvas');
  const live = () => root.querySelector('.sheet [aria-live="polite"]').textContent;
  /** Presses a key on the map; returns whether the app cancelled its default action. */
  const press = (key, opts = {}) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    act(() => map().dispatchEvent(ev));
    return ev.defaultPrevented;
  };
  const tool = (label) => act(() => [...root.querySelectorAll('.seg__btn')].find((b) => b.textContent.startsWith(label)).click());

  it('is in the tab order as a map, named by its size and described by its keys', () => {
    const m = map();
    expect(m.getAttribute('tabindex')).toBe('0');
    expect(m.getAttribute('role')).toBe('application');
    expect(m.getAttribute('aria-roledescription')).toBe('map');
    expect(m.getAttribute('aria-label')).toBe('Map, 22 by 14 cells');
    const help = document.getElementById(m.getAttribute('aria-describedby')).textContent;
    for (const words of ['Arrow keys move the cursor', 'Space or Enter uses the selected tool (Wall)', 'Shift with an arrow key draws', 'S puts the start', 'G the goal']) {
      expect(help).toContain(words);
    }
    // Sighted keyboard users get the gist beside the tools.
    expect(root.querySelector('.rail__hint').textContent).toMatch(/arrows move a cursor, Space draws, and S and G place the start and goal/);
  });

  it('says where the cursor is when the map takes focus, and draws the cursor only then', () => {
    expect(live()).toBe('');
    strokes.length = 0;
    act(() => map().focus());
    expect(live()).toBe('Row 8, column 3: start.');
    // A 3 px ring in --amber-ink (its light value here: jsdom loads no stylesheet).
    expect(strokes).toContain('#8a5200');
    strokes.length = 0;
    act(() => map().blur());
    expect(live()).toBe('');
    // Drawn again without it (the grid lines are its first stroke).
    expect(strokes[0]).toBe('#c9d8e4');
    expect(strokes).not.toContain('#8a5200');
    strokes.length = 0;
    act(() => map().focus());
    expect(strokes).toContain('#8a5200');
  });

  it('moves the cursor with the arrows, Home and End, within the map, and says what each cell is', () => {
    expect(press('ArrowRight')).toBe(true);
    expect(live()).toBe('Row 8, column 4: open.');
    press('ArrowUp');
    expect(live()).toBe('Row 7, column 4: open.');
    expect(press('End')).toBe(true);
    expect(live()).toBe('Row 7, column 22: open.');
    press('ArrowRight');
    expect(live()).toBe('Row 7, column 22: open.');
    press('Home');
    press('ArrowLeft');
    expect(live()).toBe('Row 7, column 1: open.');
    press('ArrowDown');
    for (let i = 0; i < 19; i++) press('ArrowRight');
    expect(live()).toBe('Row 8, column 20: goal.');
  });

  it('uses the selected tool on the cursor cell with Space or Enter, as a click does', () => {
    press('ArrowUp');
    expect(press(' ')).toBe(true);
    expect(live()).toBe('Wall placed at row 7, column 20.');
    press('ArrowDown');
    press('ArrowUp');
    expect(live()).toBe('Row 7, column 20: wall.');
    expect(press('Enter')).toBe(true);
    expect(live()).toBe('Wall removed at row 7, column 20.');
    tool('Mud');
    press(' ');
    expect(live()).toBe('Mud placed at row 7, column 20.');
    press('ArrowDown');
    press('ArrowUp');
    expect(live()).toBe('Row 7, column 20: mud, costs 5.');
    tool('Erase');
    press(' ');
    expect(live()).toBe('Mud removed at row 7, column 20.');
    press(' ');
    expect(live()).toBe('Already open at row 7, column 20.');
    tool('Walls');
  });

  it('draws as it moves with Shift and an arrow', () => {
    expect(press('ArrowLeft', { shiftKey: true })).toBe(true);
    expect(live()).toBe('Wall at row 7, column 19.');
    press('ArrowLeft', { shiftKey: true });
    press('ArrowRight');
    expect(live()).toBe('Row 7, column 19: wall.');
    press('ArrowLeft');
    expect(live()).toBe('Row 7, column 18: wall.');
  });

  it('puts the start or the goal on the cursor cell with S or G, never on each other or under a tool', () => {
    press('ArrowDown');
    press('ArrowRight');
    press('ArrowRight');
    expect(live()).toBe('Row 8, column 20: goal.');
    press(' ');
    expect(live()).toBe('The goal is here: press G on another cell to move it.');
    press('s');
    expect(live()).toBe('The goal is here; choose another cell for the start.');
    press('ArrowUp');
    press('ArrowLeft');
    // A wall here: the start takes the cell and clears it, as a dragged pin does.
    expect(press('s')).toBe(true);
    expect(live()).toBe('Start moved to row 7, column 19.');
    press('ArrowDown');
    press('ArrowUp');
    expect(live()).toBe('Row 7, column 19: start.');
    press('ArrowLeft');
    press('G', { shiftKey: true });
    expect(live()).toBe('Goal moved to row 7, column 18.');
    press('ArrowRight');
    press('g');
    expect(live()).toBe('The start is here; choose another cell for the goal.');
  });

  it('leaves other keys alone: Tab, and keys with Ctrl, Alt or Meta', () => {
    expect(press('Tab')).toBe(false);
    expect(press('ArrowRight', { ctrlKey: true })).toBe(false);
    expect(press('s', { altKey: true })).toBe(false);
    expect(press(' ', { metaKey: true })).toBe(false);
    expect(live()).toBe('The start is here; choose another cell for the goal.');
  });

  it("adds what the search made of a cell once it has run", () => {
    const grid = makeGrid(5, 3);
    grid.start = { r: 1, c: 0 };
    grid.goal = { r: 1, c: 4 };
    grid.cells[2] = WALL;
    grid.cells[3] = MUD;
    const view = {
      visited: new Map([[5, {}], [6, {}]]),
      frontier: new Map([[7, {}]]),
      done: { found: true, path: [{ r: 1, c: 0 }, { r: 1, c: 1 }] },
    };
    expect(describeCell(grid, view, 1, 0)).toBe('Row 2, column 1: start, on the final path.');
    expect(describeCell(grid, view, 1, 2)).toBe('Row 2, column 3: open, in the frontier.');
    view.done = null;
    expect(describeCell(grid, view, 1, 1)).toBe('Row 2, column 2: open, visited.');
    expect(describeCell(grid, view, 0, 2)).toBe('Row 1, column 3: wall.');
    expect(describeCell(grid, null, 0, 3)).toBe('Row 1, column 4: mud, costs 5.');
    expect(describeCell(grid, null, 1, 4)).toBe('Row 2, column 5: goal.');
  });
});
