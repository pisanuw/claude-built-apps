import { h } from './dom';

const rows: [string, string, string][] = [
  ['W F D N A H C Z G', 'Leaps: (1,0) (1,1) (2,0) (2,1) (2,2) (3,0) (3,1) (3,2) (3,3), in all 8 directions', 'N = knight, C = camel'],
  ['K', 'W and F together: one step any way', 'K = king'],
  ['[x,y]', 'Any other leap', '[4,1] = giraffe of shogi variants'],
  ['R B Q', 'Riders: repeat W, F, or both, until blocked', 'R = rook'],
  ['NN, CC, [x,y][x,y]', 'A doubled atom is a rider of that leap', 'NN = nightrider'],
  ['R4, B{2,}, W{1,3}', 'A digit caps the distance; {min,max} sets both ends (max may be blank)', 'B{2,} = picket'],
  ['F>R{3,}', 'Two legs: one step to an empty square, then slide outward (never back)', 'F>R{3,} = giraffe'],
  ['m, c', 'Move only, capture only', 'mfW cfF = Timur pawn'],
  ['f, b, l, r', 'Forward, backward, left, right, from the mover’s side', 'fR = lance'],
  ['s, v', 'Sideways only (along the rank), vertical only (along the file)', 'sR vW'],
  ['n', 'Lame: the squares on the way must be empty', 'nN = xiangqi horse'],
  ['j', 'Must jump: at least one square on the way must be occupied', 'jD'],
  ['p', 'Hopper: jump exactly one piece on the line, then move or capture beyond it', 'mR cpR = xiangqi cannon'],
  ['i', 'Only from a rank where this piece starts', 'imfnD = pawn double step'],
];

export function rulesView(): HTMLElement {
  return h(
    'section',
    { class: 'rules' },
    h('h2', {}, 'Notation and rules'),
    h(
      'p',
      { class: 'lede' },
      'The notation is a small dialect of Ralph Betza’s funny notation, the shorthand fairy-chess players use to describe moves. Parts are written one after another (spaces and commas are optional). Each part is optional modifiers, an atom, an optional range, and an optional second leg.',
    ),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Write'), h('th', {}, 'Meaning'), h('th', {}, 'Example'))),
        h('tbody', {}, ...rows.map(([a, b, c]) => h('tr', {}, h('td', {}, h('code', {}, a)), h('td', {}, b), h('td', {}, c)))),
      ),
    ),
    h(
      'p',
      { class: 'note' },
      'Differences from full Betza notation: direction letters apply to whole directions (fN means the four knight moves that go forward), there is no a/y/g leg chaining beyond the one > leg, and modifiers apply to the whole part.',
    ),
    h('h3', {}, 'Timur chess as played here'),
    h(
      'ul',
      {},
      h('li', {}, 'An uncheckered board of 11 files by 10 ranks. Each player has a citadel: White’s sticks out beside the right end of rank 2, Black’s beside the left end of rank 9.'),
      h('li', {}, 'Black’s setup is White’s rotated half a turn, so each vizier stands on its king’s right.'),
      h('li', {}, 'Only a king may enter a citadel, and only the opponent’s. Doing so ends the game as a draw. (Historically the player could claim a draw; here it is automatic.)'),
      h('li', {}, 'Checkmate wins. Stalemate also wins for the side that delivered it.'),
      h('li', {}, 'Pawns step forward, capture diagonally forward, never move two squares, and promote on the last rank to the piece they are named for. The pawn of kings becomes a prince that moves like a king but is not royal.'),
      h('li', {}, 'Left out: the king’s once-per-game swap with another piece, extra royal pieces (prince and adventitious king), the pawn of pawns’ three-stage promotion (it becomes a prince here), and the citadel swap.'),
      h('li', {}, 'There is no repetition or fifty-move rule, as historically. If a game against the engine stalls, start a new one.'),
    ),
    h('h3', {}, 'The engine'),
    h(
      'p',
      {},
      'A negamax alpha-beta search with iterative deepening, capture-only quiescence and killer moves, running in a Web Worker. It evaluates material (each piece’s mobility-based value), a small bonus for central pieces and for advanced pawns. Inside the search it treats taking the king as winning, so checkmate and stalemate come out of the search itself. It knows nothing about any piece except what the notation says, which is why it can play your invented ones.',
    ),
  );
}
