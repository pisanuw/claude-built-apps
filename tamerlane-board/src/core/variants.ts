/**
 * Piece and variant definitions. Every move the app knows comes from the
 * `notation` strings here; there is no per-piece move code anywhere.
 */

export interface PieceDef {
  id: string;
  name: string;
  /** One or two characters drawn on the token. */
  symbol: string;
  notation: string;
  /** Losing this piece (checkmate or, in Timur, stalemate) loses the game. */
  royal?: boolean;
  /** Promotes on the far rank; the engine also rewards advancing it. */
  pawn?: boolean;
  /** Piece id a pawn becomes on the last rank. */
  promotesTo?: string;
  /** Material value in centipawns; computed from mobility when absent. */
  value?: number;
  history?: string;
}

export interface Placement {
  /** Square name such as 'f2'. */
  sq: string;
  piece: string;
}

export interface VariantDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Two citadel squares: White's beside the right end of rank 2, Black's beside the left end of rank height-1. */
  citadels: boolean;
  /** What having no legal move while not in check means for the stuck side. */
  stalemate: 'loss' | 'draw';
  pieces: PieceDef[];
  /** White's pieces. Black's are these rotated 180 degrees or flipped top to bottom. */
  setup: Placement[];
  blackSetup: 'rotate' | 'flip';
  /** One side gets a different piece in place of another (lab balance tests). */
  asymmetric?: { color: 0 | 1; replace: string; with: string };
  /** Ends the game as a draw after this many plies (0 = never). */
  maxPlies: number;
  notes?: string;
}

const PAWN = 'mfW cfF';

const pawnOf = (target: string, targetName: string, symbol: string, extra = ''): PieceDef => ({
  id: `p-${target}`,
  name: `Pawn of ${targetName}`,
  symbol,
  notation: PAWN,
  pawn: true,
  promotesTo: target,
  value: 100,
  history: `Moves and captures like every Timur pawn: one step straight ahead, captures one step diagonally ahead, no double step and no en passant. On the last rank it becomes a ${targetName.replace(/s$/, '')}.${extra}`,
});

export const TIMUR_PIECES: PieceDef[] = [
  {
    id: 'king',
    name: 'King (shah)',
    symbol: 'K',
    notation: 'K',
    royal: true,
    history:
      'One step in any direction, as in shatranj and modern chess. In Timur chess a king that reaches the opponent’s citadel may claim a draw, and a stalemated side loses rather than draws.',
  },
  {
    id: 'general',
    name: 'General (ferz)',
    symbol: 'Ge',
    notation: 'F',
    history:
      'One diagonal step: the shatranj counsellor (ferz, from Persian farzīn). In late fifteenth-century Europe this weak piece became the modern queen, one of the largest rule changes in the history of the game.',
  },
  {
    id: 'vizier',
    name: 'Vizier',
    symbol: 'Vz',
    notation: 'W',
    history:
      'One orthogonal step. The one-step orthogonal mover is so basic that fairy-chess notation uses W (wazir) as the name of the step itself; every rook move in this app is written as repeated W steps.',
  },
  {
    id: 'giraffe',
    name: 'Giraffe (zurāfa)',
    symbol: 'Gi',
    notation: 'F>R{3,}',
    history:
      'One diagonal step, then a slide of at least three squares straight outward, with nothing in the way on either leg. Fairy players call the same shape without the minimum a gryphon (F then rook outward). The giraffe has no surviving descendant in mainstream chess. In this app\u2019s notation it is the only historical piece that needs both a second leg and a minimum distance.',
  },
  {
    id: 'picket',
    name: 'Picket (talīʿa)',
    symbol: 'Pk',
    notation: 'B{2,}',
    history:
      'A bishop that must travel at least two squares. In shatranj the piece on the bishop’s square was the alfil, a two-square diagonal leaper; the picket shows that medieval players already used a long diagonal slider long before the European bishop got its modern move around 1475.',
  },
  {
    id: 'knight',
    name: 'Knight (faras)',
    symbol: 'N',
    notation: 'N',
    history: 'The (2,1) leap, unchanged from chaturanga through shatranj to modern chess.',
  },
  {
    id: 'rook',
    name: 'Rook (rukh)',
    symbol: 'R',
    notation: 'R',
    history: 'The orthogonal slider, unchanged from shatranj to modern chess. The name comes from the Persian rukh.',
  },
  {
    id: 'elephant',
    name: 'Elephant (pīl)',
    symbol: 'El',
    notation: 'A',
    history:
      'Leaps exactly two squares diagonally, jumping whatever is between: the shatranj alfil. The modern bishop stands on its square, and Spanish still calls the bishop alfil. The xiangqi elephant makes the same two-square diagonal move but can be blocked and cannot cross the river.',
  },
  {
    id: 'camel',
    name: 'Camel (jamal)',
    symbol: 'Ca',
    notation: 'C',
    history:
      'Leaps three squares one way and one square the other, a stretched knight. It always lands on a square of the same colour, so each camel only ever sees half the board. Fairy notation still names the (3,1) leap after it.',
  },
  {
    id: 'engine',
    name: 'War engine (dabbāba)',
    symbol: 'WE',
    notation: 'D',
    history:
      'Leaps exactly two squares orthogonally, over anything in between. It is often set beside siege pieces in other games such as the xiangqi cannon, but the cannon slides and captures by hopping over a screen, and no direct line of descent is established. Fairy notation calls this leap D (dabbaba).',
  },
  {
    id: 'prince',
    name: 'Prince',
    symbol: 'Pr',
    notation: 'K',
    history:
      'What the pawn of kings (and, in this app, the pawn of pawns) becomes. Historically the prince was a spare royal piece that had to be captured before the shah could be mated; here it is an ordinary king-moving piece.',
  },
  pawnOf('rook', 'rooks', 'p'),
  pawnOf('knight', 'knights', 'p'),
  pawnOf('picket', 'pickets', 'p'),
  pawnOf('giraffe', 'giraffes', 'p'),
  pawnOf('vizier', 'viziers', 'p'),
  pawnOf('prince', 'kings', 'p', ' (Here a prince: see Prince.)'),
  pawnOf('general', 'generals', 'p'),
  pawnOf('elephant', 'elephants', 'p'),
  pawnOf('camel', 'camels', 'p'),
  pawnOf('engine', 'war engines', 'p'),
  {
    ...pawnOf('prince', 'pawns', 'p'),
    id: 'p-pawns',
    history:
      'Historically the strangest piece: on the last rank it waited, could be teleported to fork or win material, and after three promotions became an adventitious king. This app simplifies it to promote straight to a prince.',
  },
];

const TIMUR_BACK: [string, string][] = [
  ['a1', 'elephant'],
  ['c1', 'camel'],
  ['e1', 'engine'],
  ['g1', 'engine'],
  ['i1', 'camel'],
  ['k1', 'elephant'],
  ['a2', 'rook'],
  ['b2', 'knight'],
  ['c2', 'picket'],
  ['d2', 'giraffe'],
  ['e2', 'general'],
  ['f2', 'king'],
  ['g2', 'vizier'],
  ['h2', 'giraffe'],
  ['i2', 'picket'],
  ['j2', 'knight'],
  ['k2', 'rook'],
  ['a3', 'p-pawns'],
  ['b3', 'p-engine'],
  ['c3', 'p-camel'],
  ['d3', 'p-elephant'],
  ['e3', 'p-general'],
  ['f3', 'p-prince'],
  ['g3', 'p-vizier'],
  ['h3', 'p-giraffe'],
  ['i3', 'p-picket'],
  ['j3', 'p-knight'],
  ['k3', 'p-rook'],
];

export const TIMUR: VariantDef = {
  id: 'timur',
  name: 'Timur chess',
  width: 11,
  height: 10,
  citadels: true,
  stalemate: 'loss',
  pieces: TIMUR_PIECES,
  setup: TIMUR_BACK.map(([sq, piece]) => ({ sq, piece })),
  blackSetup: 'rotate',
  maxPlies: 0,
  notes:
    'Simplified: no king swap, no prince or adventitious king as extra royals, and the pawn of pawns promotes straight to a prince. A king that steps into the opponent’s citadel ends the game as a draw. Stalemate is a loss for the side that cannot move.',
};

export const CLASSIC_PIECES: PieceDef[] = [
  { id: 'king', name: 'King', symbol: 'K', notation: 'K', royal: true, history: 'One step in any direction.' },
  { id: 'queen', name: 'Queen', symbol: 'Q', notation: 'Q', value: 900, history: 'Rook plus bishop: the late-fifteenth-century upgrade of the one-step ferz.' },
  { id: 'rook', name: 'Rook', symbol: 'R', notation: 'R', value: 500, history: 'The orthogonal slider, unchanged since shatranj.' },
  { id: 'bishop', name: 'Bishop', symbol: 'B', notation: 'B', value: 325, history: 'The diagonal slider that replaced the two-square alfil leap.' },
  { id: 'knight', name: 'Knight', symbol: 'N', notation: 'N', value: 300, history: 'The (2,1) leap.' },
  {
    id: 'pawn',
    name: 'Pawn',
    symbol: 'p',
    notation: 'mfW cfF imfnD',
    pawn: true,
    promotesTo: 'queen',
    value: 100,
    history: 'One step forward, two from its starting rank, captures diagonally forward. This app always promotes to a queen.',
  },
];

const CLASSIC_BACK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

export const CLASSIC: VariantDef = {
  id: 'classic',
  name: 'Classic chess (simplified)',
  width: 8,
  height: 8,
  citadels: false,
  stalemate: 'draw',
  pieces: CLASSIC_PIECES,
  setup: [
    ...CLASSIC_BACK.map((piece, i) => ({ sq: `${'abcdefgh'[i]}1`, piece })),
    ...CLASSIC_BACK.map((_, i) => ({ sq: `${'abcdefgh'[i]}2`, piece: 'pawn' })),
  ],
  blackSetup: 'flip',
  maxPlies: 0,
  notes:
    'Simplified: no castling, no en passant, pawns always promote to a queen. The king of each side starts on the e-file, so Black’s setup is a mirror rather than a rotation.',
};

export const BUILT_IN: VariantDef[] = [TIMUR, CLASSIC];

export function pieceById(v: VariantDef, id: string): PieceDef | undefined {
  return v.pieces.find((p) => p.id === id);
}

