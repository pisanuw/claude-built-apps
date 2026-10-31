export type GhostId = 'chaser' | 'ambusher' | 'flanker' | 'shy';

export const GHOST_IDS: readonly GhostId[] = ['chaser', 'ambusher', 'flanker', 'shy'];

/** How a ghost picks its next tile. */
export type Strategy = 'arcade' | 'bfs' | 'astar';

export const STRATEGIES: readonly { value: Strategy; label: string }[] = [
  { value: 'arcade', label: 'Target tile (greedy)' },
  { value: 'bfs', label: 'BFS shortest path' },
  { value: 'astar', label: 'A* shortest path' },
];

export interface GhostMeta {
  id: GhostId;
  name: string;
  letter: string;
  color: string;
  /** One line: the chase-mode targeting rule. */
  rule: string;
  /** Which 1980 arcade ghost the rule is modelled on (for lecture notes). */
  analogue: string;
}

export const GHOST_META: Readonly<Record<GhostId, GhostMeta>> = {
  chaser: {
    id: 'chaser',
    name: 'Chaser',
    letter: 'C',
    color: '#e5484d',
    rule: "Targets the runner's own tile.",
    analogue: 'Blinky (red)',
  },
  ambusher: {
    id: 'ambusher',
    name: 'Ambusher',
    letter: 'A',
    color: '#d6409f',
    rule: 'Targets four tiles ahead of the runner (four up and four left when the runner faces up, with the overflow bug on).',
    analogue: 'Pinky (pink)',
  },
  flanker: {
    id: 'flanker',
    name: 'Flanker',
    letter: 'F',
    color: '#0ea5b7',
    rule: "Takes the point two tiles ahead of the runner and doubles the vector from the Chaser to it.",
    analogue: 'Inky (cyan)',
  },
  shy: {
    id: 'shy',
    name: 'Shy',
    letter: 'S',
    color: '#e8890c',
    rule: 'Targets the runner while it is eight or more tiles away; closer than that, heads for its scatter corner.',
    analogue: 'Clyde (orange)',
  },
};
