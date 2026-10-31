/**
 * Isometries of the Poincaré disk.
 *
 * Every orientation-preserving isometry of the unit disk is a Möbius map
 *   z ↦ (α z + β) / (β̄ z + ᾱ),   |α|² − |β|² = 1,
 * and every orientation-reversing one is the same formula applied to z̄.
 * So an isometry is four reals plus a flag. Keeping matrices in this SU(1,1)
 * shape (and renormalising after each product) stops long chains of
 * compositions from drifting off the group, which matters when a drag has
 * moved the view far from where it started.
 */

export interface Iso {
  ar: number;
  ai: number;
  br: number;
  bi: number;
  /** true when the map is applied to z̄ (a reflection, or an odd product of them). */
  conj: boolean;
}

export type Pt = readonly [number, number];

export const IDENTITY: Iso = Object.freeze({ ar: 1, ai: 0, br: 0, bi: 0, conj: false });

/** Rescale so |α|² − |β|² = 1 and project back onto the SU(1,1) form. */
export function normalize(f: Iso): Iso {
  const det = f.ar * f.ar + f.ai * f.ai - f.br * f.br - f.bi * f.bi;
  if (!(det > 0) || !Number.isFinite(det)) throw new Error('not a disk isometry');
  const s = 1 / Math.sqrt(det);
  return { ar: f.ar * s, ai: f.ai * s, br: f.br * s, bi: f.bi * s, conj: f.conj };
}

/** Apply f to the point (x, y). Results are clamped just inside the disk. */
export function apply(f: Iso, x: number, y: number): [number, number] {
  const wy = f.conj ? -y : y;
  // numerator α w + β
  const nr = f.ar * x - f.ai * wy + f.br;
  const ni = f.ar * wy + f.ai * x + f.bi;
  // denominator β̄ w + ᾱ
  const dr = f.br * x + f.bi * wy + f.ar;
  const di = f.br * wy - f.bi * x - f.ai;
  const d2 = dr * dr + di * di;
  let ox = (nr * dr + ni * di) / d2;
  let oy = (ni * dr - nr * di) / d2;
  const r2 = ox * ox + oy * oy;
  if (r2 >= 1) {
    const k = (1 - 1e-12) / Math.sqrt(r2);
    ox *= k;
    oy *= k;
  }
  return [ox, oy];
}

/** f ∘ g. */
export function compose(f: Iso, g: Iso): Iso {
  // If f reads z̄, it sees the conjugate of g's matrix.
  const gar = g.ar;
  const gai = f.conj ? -g.ai : g.ai;
  const gbr = g.br;
  const gbi = f.conj ? -g.bi : g.bi;
  // [[α1, β1], [β̄1, ᾱ1]] · [[α2, β2], [β̄2, ᾱ2]]
  const ar = f.ar * gar - f.ai * gai + (f.br * gbr + f.bi * gbi);
  const ai = f.ar * gai + f.ai * gar + (f.bi * gbr - f.br * gbi);
  const br = f.ar * gbr - f.ai * gbi + (f.br * gar + f.bi * gai);
  const bi = f.ar * gbi + f.ai * gbr + (f.bi * gar - f.br * gai);
  return normalize({ ar, ai, br, bi, conj: f.conj !== g.conj });
}

export function inverse(f: Iso): Iso {
  // Matrix inverse of [[α, β], [β̄, ᾱ]] is [[ᾱ, −β], [−β̄, α]].
  const inv: Iso = { ar: f.ar, ai: -f.ai, br: -f.br, bi: -f.bi, conj: f.conj };
  if (!f.conj) return inv;
  // f(z) = M z̄  ⇒  f⁻¹(w) = conj(M⁻¹ w) = conj(M⁻¹) w̄
  return { ar: inv.ar, ai: -inv.ai, br: inv.br, bi: -inv.bi, conj: true };
}

/** The hyperbolic translation taking 0 to a (|a| < 1): z ↦ (z + a)/(ā z + 1). */
export function translation(ax: number, ay: number): Iso {
  return normalize({ ar: 1, ai: 0, br: ax, bi: ay, conj: false });
}

/** Rotation by angle t about the origin. */
export function rotation(t: number): Iso {
  return { ar: Math.cos(t / 2), ai: Math.sin(t / 2), br: 0, bi: 0, conj: false };
}

/**
 * The pure translation along the geodesic through z0 and z1 that takes z0 to
 * z1. Unlike T_{z1} ∘ T_{−z0} it has no rotational part, so repeated small
 * drags glide the picture the way a hand expects.
 */
export function translationBetween(z0: Pt, z1: Pt): Iso {
  const toOrigin = translation(-z0[0], -z0[1]);
  const w = apply(toOrigin, z1[0], z1[1]);
  return compose(translation(z0[0], z0[1]), compose(translation(w[0], w[1]), toOrigin));
}

/** Size of |f′(z)|: how much f stretches lengths near z (Euclidean). */
export function stretch(f: Iso, x: number, y: number): number {
  const wy = f.conj ? -y : y;
  const dr = f.br * x + f.bi * wy + f.ar;
  const di = f.br * wy - f.bi * x - f.ai;
  return 1 / (dr * dr + di * di);
}

/** Where f sends the origin; a quick summary of how far it moves things. */
export function image0(f: Iso): [number, number] {
  return apply(f, 0, 0);
}

export function isoEquals(f: Iso, g: Iso, eps = 1e-9): boolean {
  if (f.conj !== g.conj) return false;
  const same = Math.abs(f.ar - g.ar) + Math.abs(f.ai - g.ai) + Math.abs(f.br - g.br) + Math.abs(f.bi - g.bi);
  const neg = Math.abs(f.ar + g.ar) + Math.abs(f.ai + g.ai) + Math.abs(f.br + g.br) + Math.abs(f.bi + g.bi);
  return Math.min(same, neg) < eps;
}
