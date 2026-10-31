/**
 * Moving the view: drags, animated re-centring and keeping the matrix small.
 */
import { compose, translation, translationBetween, apply, inverse, type Iso, type Pt } from './iso';
import { rebaseElement, type Tiling } from './tiling';

/** View after dragging the screen point from → to (both in disk coordinates). */
export function dragView(view: Iso, from: Pt, to: Pt): Iso {
  return compose(translationBetween(from, to), view);
}

/** Pure translation moving the view point z a fraction t of the way to the centre. */
export function recenterAt(view: Iso, z: Pt, t: number): Iso {
  const r = Math.hypot(z[0], z[1]);
  if (r < 1e-15) return view;
  const d = 2 * Math.atanh(Math.min(r, 1 - 1e-16));
  const k = Math.tanh((t * d) / 2) / r;
  return compose(translation(-z[0] * k, -z[1] * k), view);
}

export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
}

/**
 * Swap the view for an equivalent one: view ∘ g with g an orientation-
 * preserving group element. The drawing looks identical (it is invariant
 * under the group) but the view matrix stays near the identity. Returns g
 * so world-space marks can be carried along with g⁻¹.
 */
export function rebase(T: Tiling, view: Iso): { view: Iso; g: Iso } {
  const g = rebaseElement(T, view);
  return { view: compose(view, g), g };
}

/** Map a world point into the coordinates of a rebased view. */
export function carry(g: Iso, w: Pt): [number, number] {
  return apply(inverse(g), w[0], w[1]);
}
