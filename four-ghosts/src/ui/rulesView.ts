import { GHOST_IDS, GHOST_META } from '../core/ghosts';
import { LAB_MAZE } from '../core/maze';
import { FRIGHT_SECONDS, LEVEL1_SCHEDULE } from '../core/modes';
import { SPEED } from '../core/sim';
import { h } from './dom';

export function rulesView(): HTMLElement {
  const schedule = LEVEL1_SCHEDULE.map((p) => `${p.mode} ${Number.isFinite(p.seconds) ? `${p.seconds} s` : 'forever'}`).join(' → ');
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return h(
    'section',
    { class: 'rules' },
    h('h2', {}, 'The rules'),
    h(
      'p',
      { class: 'lede' },
      'The ghosts in the 1980 arcade maze game do not search for paths. Each one has a target tile, and at every tile it picks the exit that is closest to that target in a straight line. Four different ways of choosing the target give four personalities. This lab uses an original maze and original characters, with the targeting rules as documented for the arcade ghosts.',
    ),
    h('h3', {}, 'One decision'),
    h(
      'ol',
      {},
      h('li', {}, 'List the four neighbouring tiles in the order up, left, down, right.'),
      h('li', {}, 'Drop walls, and drop the tile straight back the way the ghost came: a ghost never reverses by choice.'),
      h('li', {}, 'For each remaining tile, compute the squared straight-line distance to the target: (dx)² + (dy)². No square roots, and walls are ignored.'),
      h('li', {}, 'Take the smallest. On a tie, the earlier one in up, left, down, right order wins.'),
    ),
    h(
      'pre',
      { class: 'code' },
      `best = none
for dir in [up, left, down, right]:
    t = tile + dir
    if wall(t) or dir == reverse(heading): continue
    d = (t.x - target.x)² + (t.y - target.y)²
    if best is none or d < best.d: best = (dir, d)   # strict <, so ties keep the earlier dir
heading = best.dir`,
    ),
    h('h3', {}, 'Four targets (chase mode)'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Ghost'), h('th', {}, 'Chase target'), h('th', {}, 'Scatter corner'), h('th', {}, 'Modelled on'))),
        h(
          'tbody',
          {},
          ...GHOST_IDS.map((id) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row', style: `color: ${GHOST_META[id].color}` }, GHOST_META[id].name),
              h('td', {}, GHOST_META[id].rule),
              h('td', { class: 'mono' }, `(${LAB_MAZE.scatter[id].x}, ${LAB_MAZE.scatter[id].y})`),
              h('td', {}, GHOST_META[id].analogue),
            ),
          ),
        ),
      ),
    ),
    h(
      'p',
      { class: 'note' },
      'Scatter corners are outside the lab maze, so a scattering ghost can never reach its target and circles the block nearest to it. Coordinates are tiles, with y growing downward.',
    ),
    h('h3', {}, 'The overflow bug'),
    h(
      'p',
      {},
      'The arcade code computed "n tiles ahead" with a routine that, for the up direction, also moved the point n tiles left. So when the runner faces up, the Ambusher aims four up and four left, and the Flanker’s pivot is two up and two left. The toggle in the Maze tab switches between the bug-compatible and the intended behaviour.',
    ),
    h('h3', {}, 'Modes'),
    h('p', {}, `Level 1 schedule: ${schedule}. Every switch between scatter and chase makes every ghost outside the house reverse at its next tile; it is the only time a ghost turns straight back. Fright (here started with a button, lasting ${FRIGHT_SECONDS} s) also forces a reversal, slows the ghosts and makes them pick exits at random. The schedule clock stops while they are frightened.`),
    h('h3', {}, 'Speeds and timing'),
    h(
      'p',
      {},
      `The simulation ticks 60 times a second. At 100% an actor moves 75.76 pixels a second on 8-pixel tiles, about 9.5 tiles a second. Level 1: runner ${pct(SPEED.runner)} (${pct(SPEED.runnerFright)} during fright), ghosts ${pct(SPEED.ghost)}, ${pct(SPEED.ghostTunnel)} in the tunnel, ${pct(SPEED.ghostFright)} when frightened. Eaten ghosts return at ${pct(SPEED.eyes)}.`,
    ),
    h('h3', {}, 'What this lab simplifies'),
    h(
      'ul',
      {},
      h('li', {}, 'Ghosts decide when they arrive at a tile. The arcade decides one tile ahead, so a turn is based on where the runner is one tile later than in the arcade.'),
      h('li', {}, 'Ghosts leave the house on a timer (1, 4 and 8 s), not on dot counters. There are no dots, fruit, lives or score: it is a lab, not a game.'),
      h('li', {}, 'Eaten ghosts take a shortest path back to the house exit and rejoin there instead of entering the house. (With the greedy rule they could circle a block of this maze forever.)'),
      h('li', {}, 'There are no "no upward turn" zones, and the speed of turning corners is not modelled.'),
      h('li', {}, 'Capture is checked on the occupied tile each tick, so, as in the arcade, a ghost and the runner can occasionally pass through each other.'),
      h('li', {}, 'BFS and A* ghosts chase the runner’s own tile (or the open tile nearest their corner when scattering) and may turn back; that is what optimal pursuit means here.'),
    ),
    h('h3', {}, 'Sources'),
    h(
      'p',
      { class: 'note' },
      'The targeting rules, tie-break order, level 1 schedule and speeds follow Chad Birch, "Understanding Pac-Man Ghost Behavior" (gameinternals.com), and Jamey Pittman, "The Pac-Man Dossier". The maze, names, colours and graphics here are original.',
    ),
  );
}
