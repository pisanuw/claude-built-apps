import type { GhostId, Strategy } from './ghosts';
import { LAB_MAZE, TRACE_MAZE, type Maze } from './maze';
import { TICKS_PER_SECOND } from './modes';
import type { SimSetup } from './sim';

export interface Scenario {
  id: string;
  title: string;
  /** What to do and what to look for, in order. */
  steps: string[];
  maze: Maze;
  overflowBug: boolean;
  strategies: Record<GhostId, Strategy>;
  setup: SimSetup;
  /** Ghosts whose overlays start switched on (the rest start off). */
  focus: GhostId[];
}

const ARCADE: Record<GhostId, Strategy> = { chaser: 'arcade', ambusher: 'arcade', flanker: 'arcade', shy: 'arcade' };
/** Schedule time just after the first scatter phase, so ghosts are chasing. */
const CHASE = 7 * TICKS_PER_SECOND;

export const FREE_PLAY_ID = 'free';

export const SCENARIOS: readonly Scenario[] = [
  {
    id: FREE_PLAY_ID,
    title: 'Free play: level 1 from the start',
    steps: [
      'The runner is on autopilot. Press an arrow key (or the pad) to take over, or click a tile to drive there.',
      'The timeline shows scatter and chase phases. Watch every ghost turn around when the phase changes.',
      'Use "Next decision" to stop each time a ghost has a real choice, and read it in the inspector.',
    ],
    maze: LAB_MAZE,
    overflowBug: true,
    strategies: ARCADE,
    setup: {},
    focus: ['chaser', 'ambusher', 'flanker', 'shy'],
  },
  {
    id: 'by-hand',
    title: '1. One decision, by hand',
    steps: [
      'The Chaser is heading left toward (3, 5); the runner stands still at (7, 9).',
      'Before stepping: list its exits at (3, 5). Which one is excluded, and why?',
      'Work out the squared distance from each remaining exit tile to the target. Two of them tie at 41.',
      'Press "Next decision". The tie goes to up, because the order is up, left, down, right.',
    ],
    maze: TRACE_MAZE,
    overflowBug: true,
    strategies: ARCADE,
    setup: {
      modeTicks: CHASE,
      runner: { tile: { x: 7, y: 9 }, dir: 'left', control: 'hold' },
      ghosts: { chaser: { tile: { x: 4, y: 5 }, dir: 'left' }, ambusher: 'off', flanker: 'off', shy: 'off' },
    },
    focus: ['chaser'],
  },
  {
    id: 'overflow',
    title: '2. The overflow bug',
    steps: [
      'The runner stands still facing up. The Ambusher should aim four tiles above it, at (6, 14).',
      'With the bug on, it aims at (2, 14): four up and four left. The faded marker shows the intended target.',
      'Switch "Overflow bug" off and on, and watch both the Ambusher and the Flanker (whose pivot moves too).',
      'Press the left or right arrow: facing any other way, the bug disappears.',
    ],
    maze: LAB_MAZE,
    overflowBug: true,
    strategies: ARCADE,
    setup: {
      modeTicks: CHASE,
      runner: { tile: { x: 6, y: 18 }, dir: 'up', control: 'hold' },
      ghosts: {
        chaser: { tile: { x: 13, y: 10 }, dir: 'left' },
        ambusher: { tile: { x: 21, y: 4 }, dir: 'left' },
        flanker: { tile: { x: 21, y: 21 }, dir: 'left' },
        shy: 'off',
      },
    },
    focus: ['ambusher', 'flanker'],
  },
  {
    id: 'flanker',
    title: "3. The Flanker's vector",
    steps: [
      'The Flanker uses the Chaser as a ruler: take the point two tiles ahead of the runner, then double the vector from the Chaser to it.',
      'Press Play. The dashed line runs Chaser → pivot → target.',
      'When the Chaser is close behind the runner, the Flanker aims just ahead of it. When the Chaser is far away, the target can land far off the maze.',
    ],
    maze: LAB_MAZE,
    overflowBug: true,
    strategies: ARCADE,
    setup: {
      modeTicks: CHASE,
      runner: { tile: { x: 13, y: 21 }, dir: 'left', control: 'auto' },
      ghosts: {
        chaser: { tile: { x: 13, y: 10 }, dir: 'left' },
        ambusher: 'off',
        flanker: { tile: { x: 21, y: 4 }, dir: 'left' },
        shy: 'off',
      },
    },
    focus: ['flanker'],
  },
  {
    id: 'shy',
    title: '4. Shy never closes in',
    steps: [
      'The runner stands still in the top-right corner. Only Shy is out, and it is chasing.',
      'Press Play. The circle is eight tiles around Shy. Once the runner is inside it, Shy turns for its corner (bottom left).',
      'Out of the circle again, it turns back. It never catches a runner standing still up here; try the bottom-left corner instead (Shift-click to move the runner).',
    ],
    maze: LAB_MAZE,
    overflowBug: true,
    strategies: ARCADE,
    setup: {
      modeTicks: CHASE,
      runner: { tile: { x: 26, y: 1 }, dir: 'left', control: 'hold' },
      ghosts: { chaser: 'off', ambusher: 'off', flanker: 'off', shy: { tile: { x: 12, y: 21 }, dir: 'left' } },
    },
    focus: ['shy'],
  },
  {
    id: 'reversal',
    title: '5. Everyone turns around',
    steps: [
      'Scatter mode ends at 7.0 s; this starts at 5.5 s with all four ghosts out.',
      'Press "Next decision" a few times. At 7.0 s every ghost is told to reverse, and does so at its next tile.',
      'This is the one time a ghost may turn straight back. The same happens when fright starts.',
    ],
    maze: LAB_MAZE,
    overflowBug: true,
    strategies: ARCADE,
    setup: {
      modeTicks: 5.5 * TICKS_PER_SECOND,
      runner: { tile: { x: 13, y: 21 }, dir: 'left', control: 'auto' },
      ghosts: {
        chaser: { tile: { x: 21, y: 4 }, dir: 'right' },
        ambusher: { tile: { x: 6, y: 4 }, dir: 'left' },
        flanker: { tile: { x: 21, y: 21 }, dir: 'right' },
        shy: { tile: { x: 6, y: 21 }, dir: 'left' },
      },
    },
    focus: ['chaser', 'ambusher', 'flanker', 'shy'],
  },
  {
    id: 'greedy-loop',
    title: '6. Greedy vs shortest path',
    steps: [
      'The runner stands still at (6, 1). The Chaser uses the greedy rule; Shy has been switched to BFS. Both start on the same tile.',
      'Press Play. Shy follows a shortest path and arrives in about two seconds.',
      'Remove Shy (set it back to the target rule; it then keeps its distance) and play on: the greedy Chaser loops forever, because every straight-line choice leads it back round the same block.',
    ],
    maze: LAB_MAZE,
    overflowBug: true,
    strategies: { ...ARCADE, shy: 'bfs' },
    setup: {
      modeTicks: CHASE,
      runner: { tile: { x: 6, y: 1 }, dir: 'left', control: 'hold' },
      ghosts: {
        chaser: { tile: { x: 13, y: 10 }, dir: 'left' },
        ambusher: 'off',
        flanker: 'off',
        shy: { tile: { x: 13, y: 10 }, dir: 'left' },
      },
    },
    focus: ['chaser', 'shy'],
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
