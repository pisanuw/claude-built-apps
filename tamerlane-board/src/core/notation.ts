/**
 * A compact, Betza-like movement notation.
 *
 * A definition is a list of parts, written next to each other or separated by
 * spaces or commas. Each part is
 *
 *     modifiers atom [range] [ '>' atom [range] ]
 *
 * Atoms (one-letter leaps, all eight symmetric directions):
 *   W (1,0)  F (1,1)  D (2,0)  N (2,1)  A (2,2)  H (3,0)  C (3,1)  Z (3,2)  G (3,3)
 *   K = W + F (one step any way)   [x,y] any custom leap, e.g. [4,1]
 * Riders (slide until blocked):
 *   R = WW, B = FF, Q = R + B, or any doubled atom (NN is a nightrider).
 * Range, after an atom: a digit caps the distance (R4 = rook up to 4 squares);
 *   {min,max}, {min,} or {n} sets both ends (B{2,} = bishop that must move at
 *   least two squares). A range turns a leaper into a rider.
 * Second leg: 'F>R{3,}' = one diagonal step to an empty square, then slide
 *   outward (never back toward the start) at least three squares.
 * Modifiers, before the atom:
 *   m move only, c capture only (default: both)
 *   f b l r  forward, backward, left, right (from the mover's side; a forward
 *            and a sideways letter together must both hold)
 *   s v      sideways only (dy = 0), vertical only (dx = 0)
 *   n        lame leaper: the squares on the way must be empty (xiangqi horse)
 *   j        must jump: at least one square on the way must be occupied
 *   p        hopper rider: must jump exactly one piece, then may land (cannon)
 *   i        only from a rank where this piece starts (pawn double step)
 */

export type Vec = readonly [number, number];

export interface Leg {
  /** Unit directions (after symmetry, before direction filters). */
  vectors: Vec[];
  /** Minimum and maximum distance in steps along the vector. */
  min: number;
  max: number;
}

export interface Rule {
  legs: [Leg] | [Leg, Leg];
  move: boolean;
  capture: boolean;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sideways: boolean;
  vertical: boolean;
  lame: boolean;
  jump: boolean;
  hop: boolean;
  initial: boolean;
  /** The source text of this part, for display. */
  text: string;
}

export class NotationError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = 'NotationError';
  }
}

const ATOMS: Record<string, Vec> = {
  W: [1, 0],
  F: [1, 1],
  D: [2, 0],
  N: [2, 1],
  A: [2, 2],
  H: [3, 0],
  C: [3, 1],
  Z: [3, 2],
  G: [3, 3],
};

/** Every distinct (dx, dy) obtained from (a, b) by sign changes and swapping. */
export function symmetries([a, b]: Vec): Vec[] {
  const out: Vec[] = [];
  const seen = new Set<string>();
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const v: Vec = [x * sx || 0, y * sy || 0];
        const key = `${v[0]},${v[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(v);
        }
      }
    }
  }
  return out;
}

const MODS = 'mcfblrsvnjpi';

interface AtomSpec {
  leg: Leg;
  rider: boolean;
}

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  peek(): string {
    return this.src[this.pos] ?? '';
  }

  fail(msg: string): never {
    throw new NotationError(msg, this.pos);
  }

  skipSeparators(): void {
    while (/[\s,;]/.test(this.peek()) && this.pos < this.src.length) this.pos++;
  }

  int(): number {
    const start = this.pos;
    if (this.peek() === '-') this.pos++;
    while (/\d/.test(this.peek())) this.pos++;
    const text = this.src.slice(start, this.pos);
    if (!/^-?\d+$/.test(text)) {
      this.pos = start;
      this.fail('expected a number');
    }
    return Number(text);
  }

  atom(): AtomSpec {
    const ch = this.peek();
    let vectors: Vec[];
    let rider = false;
    if (ch === '[') {
      this.pos++;
      const x = this.int();
      if (this.peek() !== ',') this.fail("expected ',' in [x,y]");
      this.pos++;
      const y = this.int();
      if (this.peek() !== ']') this.fail("expected ']' to close [x,y]");
      this.pos++;
      if (x === 0 && y === 0) this.fail('[0,0] is not a move');
      if (Math.abs(x) > 9 || Math.abs(y) > 9) this.fail('custom leaps are limited to 9 squares per axis');
      vectors = symmetries([Math.abs(x), Math.abs(y)]);
      if (this.peek() === '[' && this.src.startsWith(`[${x},${y}]`, this.pos)) {
        this.pos += `[${x},${y}]`.length;
        rider = true;
      }
    } else if (ch === 'K') {
      this.pos++;
      vectors = [...symmetries(ATOMS.W), ...symmetries(ATOMS.F)];
    } else if (ch === 'R' || ch === 'B' || ch === 'Q') {
      this.pos++;
      rider = true;
      vectors = [];
      if (ch !== 'B') vectors.push(...symmetries(ATOMS.W));
      if (ch !== 'R') vectors.push(...symmetries(ATOMS.F));
    } else if (ATOMS[ch]) {
      this.pos++;
      vectors = symmetries(ATOMS[ch]);
      if (this.peek() === ch) {
        this.pos++;
        rider = true;
      }
    } else {
      this.fail(ch ? `unknown atom '${ch}'` : 'expected a piece atom such as W, F, N or R');
    }
    let min = 1;
    let max = rider ? Infinity : 1;
    if (/\d/.test(this.peek())) {
      max = this.int();
      if (max < 1) this.fail('range must be at least 1');
      rider = true;
    } else if (this.peek() === '{') {
      this.pos++;
      min = this.int();
      if (this.peek() === '}') {
        max = min;
      } else {
        if (this.peek() !== ',') this.fail("expected ',' or '}' in range");
        this.pos++;
        max = this.peek() === '}' ? Infinity : this.int();
      }
      if (this.peek() !== '}') this.fail("expected '}' to close range");
      this.pos++;
      if (min < 1) this.fail('minimum distance must be at least 1');
      if (max < min) this.fail('maximum distance is below the minimum');
      rider = true;
    }
    return { leg: { vectors, min, max }, rider };
  }

  part(): Rule {
    const start = this.pos;
    const mods = new Set<string>();
    while (MODS.includes(this.peek()) && this.peek() !== '') {
      mods.add(this.peek());
      this.pos++;
    }
    const first = this.atom();
    const legs: Rule['legs'] = [first.leg];
    if (this.peek() === '>') {
      this.pos++;
      if (first.rider) this.fail('the first leg of a two-leg move must be a single leap');
      const second = this.atom();
      legs.push(second.leg);
    }
    const rule: Rule = {
      legs,
      move: !mods.has('c') || mods.has('m'),
      capture: !mods.has('m') || mods.has('c'),
      forward: mods.has('f'),
      backward: mods.has('b'),
      left: mods.has('l'),
      right: mods.has('r'),
      sideways: mods.has('s'),
      vertical: mods.has('v'),
      lame: mods.has('n'),
      jump: mods.has('j'),
      hop: mods.has('p'),
      initial: mods.has('i'),
      text: this.src.slice(start, this.pos),
    };
    if (rule.hop && (legs.length > 1 || !first.rider)) {
      this.pos = start;
      this.fail("'p' (hop) applies to a single-leg rider such as R or B");
    }
    if ((rule.lame || rule.jump) && (legs.length > 1 || first.rider)) {
      this.pos = start;
      this.fail("'n' and 'j' apply to single leaps such as N or D");
    }
    if (rule.lame && rule.jump) {
      this.pos = start;
      this.fail("'n' (path must be empty) and 'j' (must jump) contradict each other");
    }
    if (filterVectors(rule, legs[0].vectors, 1).length === 0) {
      this.pos = start;
      this.fail('the direction modifiers leave no direction');
    }
    return rule;
  }
}

/** Parse a definition into rules. Throws NotationError with a position. */
export function parseNotation(src: string): Rule[] {
  const p = new Parser(src);
  const rules: Rule[] = [];
  p.skipSeparators();
  while (p.pos < src.length) {
    rules.push(p.part());
    p.skipSeparators();
  }
  if (rules.length === 0) throw new NotationError('empty definition', 0);
  return rules;
}

/** Parse, returning an error message instead of throwing. */
export function tryParse(src: string): { rules: Rule[] } | { error: string; at: number } {
  try {
    return { rules: parseNotation(src) };
  } catch (e) {
    if (e instanceof NotationError) return { error: e.message, at: e.at };
    throw e;
  }
}

/**
 * Keep the vectors allowed by a rule's direction modifiers. `forwardSign` is
 * +1 for the side moving up the board and -1 for the side moving down; left
 * and right are from the mover's point of view.
 */
export function filterVectors(rule: Rule, vectors: Vec[], forwardSign: 1 | -1): Vec[] {
  return vectors.filter(([x, y]) => {
    const fy = y * forwardSign;
    const rx = x * forwardSign;
    if (rule.forward || rule.backward) {
      if (!((rule.forward && fy > 0) || (rule.backward && fy < 0))) return false;
    }
    if (rule.left || rule.right) {
      if (!((rule.left && rx < 0) || (rule.right && rx > 0))) return false;
    }
    if (rule.sideways || rule.vertical) {
      if (!((rule.sideways && y === 0) || (rule.vertical && x === 0))) return false;
    }
    return true;
  });
}

/** Second-leg directions that continue outward from the first step. */
export function outward(first: Vec, candidates: Vec[]): Vec[] {
  return candidates.filter(([x, y]) => {
    let shared = 0;
    for (const [a, b] of [
      [first[0], x],
      [first[1], y],
    ]) {
      if (a !== 0 && b !== 0) {
        if (Math.sign(a) !== Math.sign(b)) return false;
        shared++;
      }
    }
    return shared > 0;
  });
}

/** Squares strictly between the start and a leap target, truncating toward the start. */
export function leapPath([x, y]: Vec): Vec[] {
  const m = Math.max(Math.abs(x), Math.abs(y));
  const out: Vec[] = [];
  for (let k = 1; k < m; k++) out.push([Math.trunc((x * k) / m), Math.trunc((y * k) / m)]);
  return out;
}
